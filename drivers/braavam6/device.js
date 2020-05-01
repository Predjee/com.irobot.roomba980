'use strict';

const Homey = require('homey');
const Roomba = require('../../lib/Roomba');

const CLIENT_RESET_COUNTER = 30; // Broadcast is done every 10 seconds, 30 counter ~ 5 minutes
const MEASURE_BATTERY_CAPABILITY = 'measure_battery';
const MOB_STATE_CAPABILITY = 'mob_state';
const MOB_STATE = {
  STOPPED: 'stopped',
  CLEANING: 'cleaning',
  DOCKED: 'docked',
  CHARGING: 'charging',
  TANK_STATUS: 'tank_status'
};

class BraavaM6Device extends Homey.Device {
  async onInit() {
    // Reset client every once in a while
    this._clientResetCounter = 0;

    // First migrate data properties to store
    await this._migrateDataToStore();

    // Keep track of connected state
    this._connected = false;

    // Create RoombaFinder and start listening for discovery events
    this._roombaFinder = this.getDriver().braavaFinder;
    this._roombaFinder.on(`braava:${this.getData().mac.toLowerCase()}`, this._discoveredThisRoomba.bind(this));
    this.registerCapabilityListener(MOB_STATE_CAPABILITY, this._onMobCapabilityChanged.bind(this));
  }

  /**
   * Method that tries to create a connection to a roomba using a given ip address.
   * @returns {Promise<*>}
   */
  async connect() {
    this.log('connect() -> connect');
    this.setUnavailable(Homey.__('error.offline'));

    // Destroy roombaApi if currently existing
    if (this._roombaApi) {
      await this._destroyRoombaApiInstance();
      this.log('connect() -> destroyed left-over roombaApi');
    }

    // Get device data
    const data = this.getData();
    if (!Object.prototype.hasOwnProperty.call(data, 'mac')) return this.error('missing mac property in data object');

    // Get store values
    const store = this.getStore();
    if (!Object.prototype.hasOwnProperty.call(store, 'ip')) return this.error('missing ip property in store object');

    this.log(`connect() -> connect to (mac: ${data.mac})`);

    // Create roomba instance
    this._roombaApi = new Roomba(store.auth.username, store.auth.password, store.ip);

    // Bind roomba log methods
    this._roombaApi.log = (...args) => this.log('[Roomba]', ...args);
    this._roombaApi.error = (...args) => this.error('[Roomba]', ...args);

    this.log(`connect() -> created new roomba instance (${store.auth.username}, ${store.auth.password}, ${store.ip}, ${data.mac})`);

    // Bind roomba events
    this._roombaApi.on('connected', this._onConnected.bind(this));
    this._roombaApi.on('state', this._onState.bind(this));

    try {
      this._roombaApi.connect();
    } catch (err) {
      this.error('connect() -> error', err);
      this._connected = false;
    }

    this._connected = true;
  }

  /**
   * Clean up after device instance.
   * @returns {Promise<void>}
   */
  async onDeleted() {
    await this._destroyRoombaApiInstance();

    // Remove event listener on roomba finder
    this._roombaFinder.removeListener(`roomba:${this.getData().mac.toLowerCase()}`, this._discoveredThisRoomba.bind(this));

    // Remove reference to roomba finder
    this._roombaFinder = null;
  }

  /**
   * Event handler for state events from roomba.
   * @param {Object} state
   * @private
   */
  _onState(state) {
    // Detect battery state change
    if (typeof state.batPct === 'number') {
      this.log('_onState() -> measure_battery received', state.batPct);
      this.setCapabilityValue('measure_battery', state.batPct).catch(err => this.error(`could not set capability value ${state.batPct} for measure_battery`, err));
    }

    if (state && state.cleanMissionStatus
      && state.cleanMissionStatus.cycle
      && state.cleanMissionStatus.phase) {
      const cycle = state.cleanMissionStatus.cycle;
      const phase = state.cleanMissionStatus.phase;

      this.log(`_onState() -> cycle: ${cycle}, phase: ${phase}`);

      if (cycle === 'none' && phase === 'charge') {
        if (this.getCapabilityValue(MEASURE_BATTERY_CAPABILITY) === 100) {
          this.setCapabilityValue(MOB_STATE_CAPABILITY, 'docked')
            .catch(err => this.error(`could not set capability value ${state.batPct} for measure_battery`, err));
        } else {
          this.setCapabilityValue(MOB_STATE_CAPABILITY, MOB_STATE.CHARGING)
            .catch(err => this.error('could not set capability value charging for MOB_STATE', err));
        }
      } else if (phase === 'stop') {
        this.setCapabilityValue(MOB_STATE_CAPABILITY, MOB_STATE.STOPPED)
          .catch(err => this.error('could not set capability value stopped for MOB_STATE', err));
      } else if (cycle === 'dock' && phase === 'hmUsrDock') {
        this.setCapabilityValue(MOB_STATE_CAPABILITY, MOB_STATE.DOCKED)
          .catch(err => this.error('could not set capability value docked for MOB_STATE', err));
      } else if (cycle === 'quick' && phase === 'run') {
        this.setCapabilityValue(MOB_STATE_CAPABILITY, MOB_STATE.CLEANING)
          .catch(err => this.error('could not set capability value cleaning for MOB_STATE', err));
      }
    }
  }

  /**
   * Capability value changed handler for MOB_STATE.
   * @param {string} value
   * @returns {Promise<IPublishPacket>}
   * @private
   */
  _onMobCapabilityChanged(value) {
    // Check if API is initialized
    if (!this._roombaApi) {
      this.error('_onMobCapabilityChanged() -> error roombaApi not initialised');
      return null;
    }

    try {
      // Determine desired action
      switch (value) {
        case MOB_STATE.CLEANING:
          return this._roombaApi.start();
        case MOB_STATE.SPOT_CLEANING:
          return Promise.reject(new Error(Homey.__('error.spot_cleaning')));
        case MOB_STATE.DOCKED:
          return this._roombaApi.dock();
        case MOB_STATE.CHARGING:
          return this._roombaApi.dock();
        case MOB_STATE.STOPPED:
          return this._roombaApi.stop();
        case MOB_STATE.TANK_STATUS:
          return this._roombaApi.waitPreferences(false, ['tankLvl'], true);;
        default:
          this.error('_onMobCapabilityChanged() -> received unknown value:', value);
          return Promise.reject(new Error(Homey.__('error.failed_state_change')));
      }
    } catch (err) {
      this.log('_onMobCapabilityChanged() -> error', err);
      return Promise.reject(new Error(Homey.__('error.failed_state_change')));
    }
  }

  /**
   * This method is called every time the RoombaFinder detects the roomba on the network. In case the IP is changed it is
   * updated and a reconnect will be performed on the new IP.
   * @param {string} ip
   * @returns {Promise<void>}
   * @private
   */
  async _discoveredThisRoomba({ ip }) {
    this.log('_discoveredThisRoomba() -> ip', ip);

    // Broadcast is done every 10 seconds, 30 counter ~ 5 minutes
    this._clientResetCounter++;

    const ipChanged = this._checkIpChanged(ip);
    if (ipChanged) {
      if (ip) await this.setStoreValue('ip', ip); // Update ip address
      this.log(`_discoveredThisRoomba() -> ip changed to ${ip}`);
    }

    if (!this._connected || ipChanged || this._clientResetCounter === CLIENT_RESET_COUNTER) {
      // Connect to roomba (on possibly new ip address)
      this.connect().catch(err => this.error('connect() -> unknown error', err));
    }
  }

  /**
   * Method that checks if a given IP address is different from the currently known IP address of the roomba.
   * @param {string} ip
   * @returns {boolean}
   * @private
   */
  _checkIpChanged(ip) {
    if (typeof ip !== 'string') throw new Error('invalid_ip');
    const currentIp = this.getStoreValue('ip');
    return ip !== currentIp;
  }

  /**
   * Connected to roomba client event. Mark device as available.
   * @private
   */
  _onConnected() {
    this.log('_onConnected()');
    if (!this.getAvailable()) this.setAvailable().catch(err => this.error('could not set available', err));
  }

  /**
   * Destroy roomba api instance.
   * @returns {Promise<void>}
   * @private
   */
  async _destroyRoombaApiInstance() {
    this.log('_disconnectFromRobot()');
    if (this._roombaApi) {
      this._roombaApi.removeAllListeners();
      await this._roombaApi.end();
    }
    this._roombaApi = null; // important
  }

  /**
   * Perform migration steps. Properties 'ip' and 'auth' are moved from data to store.
   * @returns {Promise<void>}
   * @private
   */
  async _migrateDataToStore() {
    const data = this.getData();
    const store = this.getStore();

    if (Object.prototype.hasOwnProperty.call(data, 'ip') && !Object.prototype.hasOwnProperty.call(store, 'ip')) {
      await this.setStoreValue('ip', data.ip).catch(err => this.error('_migrateDataToStore() -> failed to migrate ip', err));
    }
    if (Object.prototype.hasOwnProperty.call(data, 'auth') && !Object.prototype.hasOwnProperty.call(store, 'auth')) {
      await this.setStoreValue('auth', data.auth).catch(err => this.error('_migrateDataToStore() -> failed to migrate auth', err));
    }
  }
}

module.exports = BraavaM6Device;
