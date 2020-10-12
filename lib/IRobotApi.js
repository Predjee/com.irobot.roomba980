'use strict';

const EventEmitter = require('events');

const MQTT = require('async-mqtt');

const THREE_SECONDS = 3 * 1000;
const MQTT_CONFIGURATION = {
  port: 8883,
  rejectUnauthorized: false,
  protocolId: 'MQTT',
  protocolVersion: 4,
  clean: false,
  ciphers: 'AES128-SHA256',
};

/**
 * Interface to a iRobotDevice.
 * @class IrobotDevice
 */
class IRobotApi extends EventEmitter {
  /**
   * Roomba constructor sets private properties needed for MQTT connection.
   * @param {string} username
   * @param {string} password
   * @param {string} host
   */
  constructor(username, password, host) {
    super();

    if (typeof username !== 'string') throw new Error('invalid_username');
    if (typeof password !== 'string') throw new Error('invalid_password');
    if (typeof host !== 'string') throw new Error('invalid_host');

    this._username = username.replace('\0', '');
    this._password = password.replace('\0', '');
    this._host = host;
  }

  /**
   * Creates an MQTT connection to this Roomba. Requires _host, _username and _password properties set on this context.
   * Additionally, it binds relevant events on the client.
   */
  connect() {
    try {
      this._client = MQTT.connect(`tls://${this._host}`, {
        ...MQTT_CONFIGURATION,
        clientId: this._username,
        username: this._username,
        password: this._password,
      });
    } catch (err) {
      this.error('err', err);
      this.log(err);
      throw new Error('failed_to_connect_to_roomba');
    }

    // Bind client events
    this._client.on('error', this._onClientError.bind(this));
    this._client.on('connect', this._onClientConnect.bind(this));
    this._client.on('packetreceive', this._parseReceivedPacket.bind(this));
  }

  /**
   * Start cleaning.
   * @returns {Promise<IPublishPacket>}
   */
  async start() {
    return this._call('cmd', 'start');
  }

  /**
   * Pause cleaning.
   * @returns {Promise<IPublishPacket>}
   */
  async pause() {
    return this._call('cmd', 'pause');
  }

  /**
   * Stop cleaning.
   * @returns {Promise<IPublishPacket>}
   */
  async stop() {
    return this._call('cmd', 'stop');
  }

  /**
   * Resume cleaning.
   * @returns {Promise<IPublishPacket>}
   */
  async resume() {
    return this._call('cmd', 'resume');
  }

  /**
   * Return to dock.
   * @returns {Promise<IPublishPacket>}
   */
  async dock() {
    return this._call('cmd', 'dock');
  }

  /**
   * End the connection with the Roomba.
   * @returns {Promise<void>}
   */
  async end() {
    this.log('end connection');
    try {
      if (this._client) {
        await this._client.end();
        if (this._client.stream) {
          this._client.stream.removeAllListeners();
          this._client.stream.end();
        }
        this._client.removeAllListeners();
        this._client = null;
      }
    } catch (e) {
      this.error('end', e);
    }
  }

  /**
   * Method that parses an incoming packet from Roomba.
   * @param {Object} packet
   * @private
   */
  _parseReceivedPacket(packet) {
    if (!packet.payload) {
      return;
    }

    try {
      const msg = JSON.parse(packet.payload.toString());

      // Debounce only when there is no cleaningMissionStatus update
      if (msg && msg.state && msg.state.reported) {
        clearTimeout(this.stateEmitDebounce);
        this._state = Object.assign(this._state || {}, msg.state.reported);
        if (this._state.cleanMissionStatus && this._state.cleanMissionStatus.cycle) {
          this.emit('state', this._state);
        } else {
          this.stateEmitDebounce = setTimeout(() => {
            this.emit('state', this._state);
          }, THREE_SECONDS);
        }
      } else {
        console.log(msg);
      }
    } catch (err) {
      this.error('failed to parse received packet', err);
    }
  }

  /**
   * API call wrapper for Roomba.
   * @param {string} topic
   * @param {string} command
   * @returns {Promise<IPublishPacket>}
   * @private
   */
  async _call(topic, command) {
    let cmd = {
      command,
      time: Date.now() / 1000 | 0,
      initiator: 'Homey',
    };

    if (topic === 'delta') {
      cmd = {
        state: command,
      };
    }
    this.log(`send command (topic: ${topic})`, cmd);
    try {
      await this._client.publish(topic, JSON.stringify(cmd));
    } catch (err) {
      this.error('send command error', err);
    }
    this.log(`send command done (topic: ${topic})`, cmd);
    return true; // Make sure capability sets get resolved
  }

  /**
   * Client error event handler.
   * @param err
   * @private
   */
  _onClientError(err) {
    this.error('mqtt client error', err);
  }

  /**
   * Client connected event handler.
   * @private
   */
  _onClientConnect() {
    this.emit('connected');
    this.log('mqtt client connected');
  }
}

module.exports = IRobotApi;
