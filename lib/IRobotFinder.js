'use strict';

const dgram = require('dgram');
const EventEmitter = require('events');

const MESSAGE = 'irobotmcs';
const ROOMBA_HOSTNAME = 'Roomba';
const IROBOT_HOSTNAME = 'iRobot';
const DISCOVERY_SERVER_PORT = 5678;
const DISCOVERY_SERVER_ADDR = '0.0.0.0';
const MESSAGE_BUFFER = Buffer.from(MESSAGE);
const BROADCAST_ADDRESS = '255.255.255.255';
const BROADCASTING_INTERVAL = 10 * 1000; // 10 sec
const DGRAM_UDP_CONFIG = {
  type: 'udp4',
  reuseAddr: true,
};

/**
 * This class attempts to find new Roombas on the network.
 */
class IRobotFinder extends EventEmitter {
  constructor(props) {
    super(props);

    if(!IRobotFinder.instance){
      IRobotFinder.instance = this;
    }

    // Create object where found devices will be stored
    this._devices = {mob:[], vacuum:[]};

    IRobotFinder.instance._startDiscovery();

    return IRobotFinder.instance;
  }

  /**
   * Start discovery server and start broadcasting discovery message.
   */
  _startDiscovery() {
    if (this.server) {
      this.server.close(); // Close server if already present
    }
    if (this._broadcastInterval) clearInterval(this._broadcastInterval); // Clear interval if already present

    // Create new server
    this.server = dgram.createSocket(DGRAM_UDP_CONFIG);
    this.server.on('error', err => {
      this.error('discovery server error', err);
      this._startDiscovery(); // Restart server
    });
    this.server.on('message', this._onMessage.bind(this));
    this.server.bind(DISCOVERY_SERVER_PORT, DISCOVERY_SERVER_ADDR)

    // When listening has started broadcast and broadcast every 10 seconds afterwards
    this.server.on('listening', () => {
      this.log('started listening for roombas...');
      this._broadcastDiscoveryMessage();
    });

    // Start broadcasting interval
    this._broadcastInterval = setInterval(this._broadcastDiscoveryMessage.bind(this), BROADCASTING_INTERVAL);
  }

  /**
   * Broadcast the message to the entire internal network, regardless of subnet.
   * Be wary, the Roomba responds with a broadcast within its own subnet, so you do
   * have to be in the same subnet to get a result.
   * @private
   */
  _broadcastDiscoveryMessage() {
    this.log('broadcast pair message');
    try {
      this.server.setBroadcast(true);
      this.server.send(MESSAGE_BUFFER, 0, MESSAGE_BUFFER.length, DISCOVERY_SERVER_PORT, BROADCAST_ADDRESS);
    } catch (err) {
      this.error(err);
    }
  }

  /**
   * Message event handler.
   * @param {Object} message
   * @private
   */
  _onMessage(message) {
    const parsed = this._parseMessage(message);
    if (!parsed) return null;

    const deviceType = parsed.sku.substring(0, 2) === 'm6' ? 'mob' : 'vacuum';
    this.log(`received message from ${deviceType} (mac: ${parsed.mac})`);
    this._devices[deviceType][parsed.mac] = parsed;

    this.emit(`${deviceType}:${parsed.mac.toLowerCase()}`, parsed);
  }

  /**
   * Try to parse incoming message from Roomba.
   * @param message
   * @returns {any}
   * @private
   */
  _parseMessage(message) {
    if (message.toString() === MESSAGE) return null;

    try {
      const parsed = JSON.parse(message);
      const { hostname } = parsed;
      const splitHostname = hostname.split('-');

      if (splitHostname[0] !== ROOMBA_HOSTNAME && splitHostname[0] !== IROBOT_HOSTNAME) {
        return null;
      }
      const username = splitHostname[1];

      return {
        ...parsed,
        username,
      };
    } catch (err) {
      this.error('_parseMessage() -> failed to parse message', err);
      return null;
    }
  }

  /**
   * Getter for currently found mobs.
   * @returns {BraavaDevice[]}
   */
  get mob() {
    return Object.values(this._devices.mob);
  }

  /**
   * Getter for currently found roombas.
   * @returns {IRobotDevice[]}
   */
  get vacuum() {
    return Object.values(this._devices.vacuum);
  }

  /**
   * Clean up server and discovery interval.
   */
  destroy() {
    this.log('destroy()');
    if (this._broadcastInterval) clearInterval(this._broadcastInterval);
    if (this.server) {
      this.server.close();
      this.server.removeAllListeners();
    }
    this._devices = {mob:[], vacuum:[]};
  }
}

module.exports = IRobotFinder;
