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

class BraavaDevice extends Homey.Device {
  async onInit() {
    // Reset client every once in a while
    this._clientResetCounter = 0;

    // Keep track of connected state
    this._connected = false;

    // Create IRobotFinder and start listening for discovery events
    this._irobotFinder = this.driver.irobotFinder;
    this._irobotFinder.on(`mob:${this.getData().mac.toLowerCase()}`, this._discoveredThisIRobot.bind(this));
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

    let alarmTankFull = this.homey.flow.getConditionCard('tank_full');
    alarmTankFull.registerRunListener((args, state) => {
      return Promise.resolve(args.device.getCapabilityValue('tank_full'));
    });

    let alarmTankPresent = this.homey.flow.getConditionCard('tank_present')
    alarmTankPresent.registerRunListener((args, state) => {
      return Promise.resolve(args.device.getCapabilityValue('tank_present'));
    });

    let alarmLidClosed = this.homey.flow.getConditionCard('lid_closed')
    alarmLidClosed.registerRunListener((args, state) => {
      return Promise.resolve(args.device.getCapabilityValue('lid_closed'));
    });

    let noPadDetected = this.homey.flow.getConditionCard('no_pad_detected')
    noPadDetected.registerRunListener((args, state) => {
      return Promise.resolve(args.device.getCapabilityValue('detected_pad'));
    });
  }

  /**
   * Clean up after device instance.
   * @returns {Promise<void>}
   */
  async onDeleted() {
    await this._destroyIRobotApiInstance();

    // Remove event listener on iRobot finder
    this._irobotFinder.removeListener(`mob:${this.getData().mac.toLowerCase()}`, this._discoveredThisIRobot.bind(this));

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

    if (typeof state.tankLvl === 'number') {
      this.log('_onState() -> tank_level received', state.tankLvl);
      this.setCapabilityValue('tank_full', parseInt(state.tankLvl) === 100).catch(err => this.error(`could not set capability value ${state.tankLvl} for tank_full`, err));
    }

    if (typeof state.mopReady === 'object') {
      this.setCapabilityValue('tank_present', state.mopReady.tankPresent).catch(err => this.error(`could not set capability value ${state.mopReady.tankPresent} for tank_present`, err));
      this.setCapabilityValue('lid_closed', state.mopReady.lidClosed).catch(err => this.error(`could not set capability value ${state.mopReady.lidClosed} for lid_closed`, err));
    }

    if (typeof state.detectedPad === 'string') {
      if (!this.hasCapability('detected_pad')) {
        this.addCapability('detected_pad');
      }

      let detectedPad = true;
      if (state.detectedPad === 'invalid') {
        detectedPad = false;
      }

      this.setCapabilityValue('detected_pad', detectedPad).catch(err => this.error(`could not set capability value ${detectedPad} for detected_pad`, err));
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
    this._iRobotApi = null;
  }
}

module.exports = BraavaDevice;
