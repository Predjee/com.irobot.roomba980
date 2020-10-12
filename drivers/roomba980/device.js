'use strict';

const Homey = require('homey');
const IRobotApi = require('../../lib/IRobotApi');

const CLIENT_RESET_COUNTER = 30; // Broadcast is done every 10 seconds, 30 counter ~ 5 minutes
const MEASURE_BATTERY_CAPABILITY = 'measure_battery';
const VACUUMCLEANER_STATE_CAPABILITY = 'vacuumcleaner_state';
const VACUUMCLEANER_STATE = {
  STOPPED: 'stopped',
  CLEANING: 'cleaning',
  SPOT_CLEANING: 'spot_cleaning',
  DOCKED: 'docked',
  CHARGING: 'charging',
};

class Roomba980 extends Homey.Device {
  async onInit() {
    // Reset client every once in a while
    this._clientResetCounter = 0;

    // First migrate data properties to store
    await this._migrateDataToStore();

    // Keep track of connected state
    this._connected = false;

    // Create IRobotFinder and start listening for discovery events
    this._irobotFinder = this.driver.irobotFinder;
    this._irobotFinder.on(`vacuum:${this.getData().mac.toLowerCase()}`, this._discoveredThisIRobot.bind(this));
    this.registerCapabilityListener(VACUUMCLEANER_STATE_CAPABILITY, this._onVacuumCapabilityChanged.bind(this));
  }

  /**
   * Method that tries to create a connection to a iRobot using a given ip address.
   * @returns {Promise<*>}
   */
  async connect() {
    this.log('connect() -> connect');
    this.setUnavailable(this.homey.__('error.offline'));

    // Destroy iRobot if currently existing
    if (this._iRobotApi) {
      await this._destroyIRobotApiInstance();
      this.log('connect() -> destroyed left-over iRobotApi');
    }

    // Get device data
    const data = this.getData();
    if (!Object.prototype.hasOwnProperty.call(data, 'mac')) return this.error('missing mac property in data object');

    // Get store values
    const store = this.getStore();
    if (!Object.prototype.hasOwnProperty.call(store, 'ip')) return this.error('missing ip property in store object');

    this.log(`connect() -> connect to (mac: ${data.mac})`);

    // Create iRobot instance
    this._iRobotApi = new IRobotApi(store.auth.username, store.auth.password, store.ip);

    // Bind iRobot log methods
    this._iRobotApi.log = (...args) => this.log('[iRobot]', ...args);
    this._iRobotApi.error = (...args) => this.error('[iRobot]', ...args);

    this.log(`connect() -> created new iRobot instance (${store.auth.username}, ${store.auth.password}, ${store.ip}, ${data.mac})`);

    // Bind iRobot events
    this._iRobotApi.on('connected', this._onConnected.bind(this));
    this._iRobotApi.on('state', this._onState.bind(this));

    try {
      this._iRobotApi.connect();
    } catch (err) {
      this.error('connect() -> error', err);
      this._connected = false;
    }

    this._connected = true;

    let binFullCodition = this.homey.flow.getConditionCard('bin_full');
    binFullCodition.registerRunListener((args, state) => {
      return Promise.resolve(args.device.getCapabilityValue('bin_full'));
    });

    let binPresentCondition = this.homey.flow.getConditionCard('bin_present')
    binPresentCondition.registerRunListener((args, state) => {
      return Promise.resolve(args.device.getCapabilityValue('bin_present'));
    });
  }

  /**
   * Clean up after device instance.
   * @returns {Promise<void>}
   */
  async onDeleted() {
    await this._destroyIRobotApiInstance();

    // Remove event listener on iRobot finder
    this._irobotFinder.removeListener(`vacuum:${this.getData().mac.toLowerCase()}`, this._discoveredThisIRobot.bind(this));

    // Remove reference to iRobot finder
    this._irobotFinder = null;
  }

  /**
   * Event handler for state events from iRobot.
   * @param {Object} state
   * @private
   */
  _onState(state) {
    if (typeof state.batPct === 'number') {
      this.log('_onState() -> measure_battery received', state.batPct);
      this.setCapabilityValue('measure_battery', state.batPct).catch(err => this.error(`could not set capability value ${state.batPct} for measure_battery`, err));
    }

    if (typeof state.bin === 'object' && typeof state.bin.full === 'boolean') {
      this.log('_onState() -> bin_full received', state.bin.full);
      if (!this.hasCapability('bin_full')) {
        this.addCapability('bin_full');
      }
      if (!this.hasCapability('bin_present')) {
        this.addCapability('bin_present');
      }
      this.setCapabilityValue('bin_full', state.bin.full).catch(err => this.error(`could not set capability value ${state.bin.full} for bin_full`, err));
      this.setCapabilityValue('bin_present', state.bin.present).catch(err => this.error(`could not set capability value ${state.bin.present} for bin_present`, err));
    }

    if (state && state.cleanMissionStatus
      && state.cleanMissionStatus.cycle
      && state.cleanMissionStatus.phase) {
      const cycle = state.cleanMissionStatus.cycle;
      const phase = state.cleanMissionStatus.phase;

      this.log(`_onState() -> cycle: ${cycle}, phase: ${phase}`);

      if (cycle === 'none' && phase === 'charge') {
        if (this.getCapabilityValue(MEASURE_BATTERY_CAPABILITY) === 100) {
          this.setCapabilityValue(VACUUMCLEANER_STATE_CAPABILITY, VACUUMCLEANER_STATE.DOCKED)
            .catch(err => this.error(`could not set capability value ${state.batPct} for measure_battery`, err));
        } else {
          this.setCapabilityValue(VACUUMCLEANER_STATE_CAPABILITY, VACUUMCLEANER_STATE.CHARGING)
            .catch(err => this.error('could not set capability value charging for vacuumcleaner_state', err));
        }
      } else if (phase === 'stop') {
        this.setCapabilityValue(VACUUMCLEANER_STATE_CAPABILITY, VACUUMCLEANER_STATE.STOPPED)
          .catch(err => this.error('could not set capability value stopped for vacuumcleaner_state', err));
      } else if (cycle === 'dock' && phase === 'hmUsrDock') {
        this.setCapabilityValue(VACUUMCLEANER_STATE_CAPABILITY, VACUUMCLEANER_STATE.DOCKED)
          .catch(err => this.error('could not set capability value docked for vacuumcleaner_state', err));
      } else if (cycle === 'quick' && phase === 'run') {
        this.setCapabilityValue(VACUUMCLEANER_STATE_CAPABILITY, VACUUMCLEANER_STATE.CLEANING)
          .catch(err => this.error('could not set capability value cleaning for vacuumcleaner_state', err));
      } else if (cycle === 'spot' && phase === 'run') {
        this.setCapabilityValue(VACUUMCLEANER_STATE_CAPABILITY, VACUUMCLEANER_STATE.SPOT_CLEANING).catch(err => this.error('could not set capability value spot_cleaning for vacuumcleaner_state', err));
      }
    }
  }

  /**
   * Capability value changed handler for vacuumcleaner_state.
   * @param {string} value
   * @returns {Promise<IPublishPacket>}
   * @private
   */
  _onVacuumCapabilityChanged(value) {
    // Check if API is initialized
    if (!this._iRobotApi) {
      this.error('_onVacuumCapabilityChanged() -> error iRobotApi not initialised');
      return null;
    }

    try {
      // Determine desired action
      switch (value) {
        case VACUUMCLEANER_STATE.CLEANING:
          return this._iRobotApi.start();
        case VACUUMCLEANER_STATE.SPOT_CLEANING:
          return Promise.reject(new Error(this.homey.__('error.spot_cleaning')));
        case VACUUMCLEANER_STATE.DOCKED:
          return this._iRobotApi.dock();
        case VACUUMCLEANER_STATE.CHARGING:
          return this._iRobotApi.dock();
        case VACUUMCLEANER_STATE.STOPPED:
          return this._iRobotApi.stop();
        default:
          this.error('_onVacuumCapabilityChanged() -> received unknown value:', value);
          return Promise.reject(new Error(this.homey.__('error.failed_state_change')));
      }
    } catch (err) {
      this.log('_onVacuumCapabilityChanged() -> error', err);
      return Promise.reject(new Error(this.homey.__('error.failed_state_change')));
    }
  }

  /**
   * This method is called every time the IRobotFinder detects the iRobot on the network. In case the IP is changed it is
   * updated and a reconnect will be performed on the new IP.
   * @param {string} ip
   * @returns {Promise<void>}
   * @private
   */
  async _discoveredThisIRobot({ip}) {
    this.log('_discoveredThisIRobot() -> ip', ip);

    // Broadcast is done every 10 seconds, 30 counter ~ 5 minutes
    this._clientResetCounter++;

    const ipChanged = this._checkIpChanged(ip);
    if (ipChanged) {
      if (ip) await this.setStoreValue('ip', ip); // Update ip address
      this.log(`_discoveredThisIRobot() -> ip changed to ${ip}`);
    }

    if (!this._connected || ipChanged || this._clientResetCounter === CLIENT_RESET_COUNTER) {
      // Connect to iRobot (on possibly new ip address)
      this.connect().catch(err => this.error('connect() -> unknown error', err));
    }
  }

  /**
   * Method that checks if a given IP address is different from the currently known IP address of the iRobot.
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
   * Connected to iRobot client event. Mark device as available.
   * @private
   */
  _onConnected() {
    this.log('_onConnected()');
    if (!this.getAvailable()) this.setAvailable().catch(err => this.error('could not set available', err));
  }

  /**
   * Destroy iRobot api instance.
   * @returns {Promise<void>}
   * @private
   */
  async _destroyIRobotApiInstance() {
    this.log('_disconnectFromRobot()');
    if (this._iRobotApi) {
      this._iRobotApi.removeAllListeners();
      await this._iRobotApi.end();
    }
    this._iRobotApi = null; // important
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

module.exports = Roomba980;
