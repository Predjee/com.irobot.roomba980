'use strict';

const Homey = require('homey');
const tls = require('tls');
const RoombaFinder = require('../../lib/RoombaFinder');

const ROOMBA_PORT = 8883;
const GET_PASSWORD_TIMEOUT = 5000;
const GET_PASSWORD_INTERVAL = 10000;
const GET_PASSWORD_INTERVAL_TIMEOUT = 60000;
const GET_PASSWORD_MESSAGE = 'f005efcc3b2900';
const PAIR_EVENT_AUTHENTICATED = 'deviceAuthenticated';

const ERROR_IN_USE = 'in_use';
const ERROR_NO_DEVICE = 'no_device_selected';
const ERROR_CODE_CONN_REFUSED = 'ECONNREFUSED';
const ERROR_INVALID_DEVICE = 'invalid_device_selected';
const ERROR_GET_PASSWORD_TIMEOUT = 'get_password_timeout';
const ERROR_NO_RESPONSE_PASSWORD_GET = 'no_response_on_password_request';

class Roomba980Driver extends Homey.Driver {
  onInit() {
    // Create roomba finder used during pairing
    this._roombaFinder = new RoombaFinder();
    this._roombaFinder.log = (...args) => this.log('[RoombaFinder]', ...args);
    this._roombaFinder.error = (...args) => this.error('[RoombaFinder]', ...args);
  }

  /**
   * Getter for protected roomba finder instance.
   * @returns {RoombaFinder}
   */
  get roombaFinder() {
    return this._roombaFinder;
  }

  /**
   * Return found roobma devices and exchange password when user presses button on roomba.
   * @param socket
   */
  onPair(socket) {
    socket.on('list_devices', (data, callback) => {
      const devices = this._roombaFinder.roombas.map(roomba => this._mapRoombaToDeviceObject(roomba));
      return callback(null, devices);
    });

    socket.on('list_devices_selection', (data, callback) => {
      if (callback) callback(null, true); // quick callback
      this.log('onPair() -> selected device', data[0]);

      // No device selected, should not be possible
      if (data.length === 0) {
        this.error('onPair() -> no device selected');
        return socket.emit(PAIR_EVENT_AUTHENTICATED, new Error(ERROR_NO_DEVICE));
      }

      // Validate device object
      const device = data[0];
      if (!device || !Object.prototype.hasOwnProperty.call(device, 'store')
        || !Object.prototype.hasOwnProperty.call(device.store, 'ip')
        || !Object.prototype.hasOwnProperty.call(device.store, 'auth')
      ) {
        this.error('onPair() -> received invalid device object', device);
        return socket.emit(PAIR_EVENT_AUTHENTICATED, new Error(ERROR_INVALID_DEVICE));
      }

      this.log(`onPair() -> check (ip: ${device.store.ip})`);

      // Get password on interval
      this._getPasswordOnInterval(device.store.ip)
        .then(password => {
          this.log('onPair() -> retrieved password, continue adding device...');

          // Store password in device data object
          device.store.auth.password = password;
          return socket.emit(PAIR_EVENT_AUTHENTICATED, device);
        })
        .catch(err => {
          this.error('onPair() -> error while retrieving password', err);
          if (err.message === ERROR_GET_PASSWORD_TIMEOUT) { // Abort on timeout error
            return socket.emit(PAIR_EVENT_AUTHENTICATED, err);
          }
          if (err.message === ERROR_IN_USE) { // Abort on error in use
            return socket.emit(PAIR_EVENT_AUTHENTICATED, err);
          }
        });
    });
  }


  /**
   * Get password from Roomba.
   * @param {string} ip
   * @returns {Promise<unknown>}
   * @private
   */
  async _getPassword(ip) {
    this.log(`_getPassword() -> ip: ${ip}`);

    return new Promise((resolve, reject) => {
      const client = tls.connect(ROOMBA_PORT, ip, {
        rejectUnauthorized: false,
      });

      let found = false;

      const timeout = setTimeout(() => {
        this.log(`_getPassword() -> client timeout, closing socket... (ip: ${ip})`);
        client.end();
      }, GET_PASSWORD_TIMEOUT);

      // This hex code results in the Roomba relaying its password back to us
      // Legacy was undocumented so we're not sure why it's this string specifically
      client.once('secureConnect', () => {
        this.log(`_getPassword() -> request password from roomba (ip: ${ip})`);
        client.write(Buffer.from(GET_PASSWORD_MESSAGE, 'hex'));
      });

      client.on('error', (e) => {
        this.error(`_getPassword() -> client error (ip: ${ip})`, e);
        if (e.code === ERROR_CODE_CONN_REFUSED) {
          // Someone else is already connected
          clearTimeout(timeout);
          client.end();
          return reject(e);
        }
      });

      let sliceIndex = 13;
      client.on('data', (data) => {
        if (data.length === 2) {
          // UDP package of size 2 indicates a different data format for the password
          // so we adjust the slicing index
          sliceIndex = 9;
          this.log(`_getPassword() -> adjust slicing index to 9 (ip: ${ip})`);
        } else if (data.length > 7) {
          // UDP packages of length 7 and higher indicate the password has been sent to
          // us. Parse the password by creating a buffer and slicing it at the determined
          // slicing index. Turn the result into a string.
          clearTimeout(timeout);
          client.end();

          this.log(`_getPassword() -> received password (ip: ${ip})`);
          found = true;
          return resolve(Buffer.from(data).slice(sliceIndex).toString());
        }
      });

      client.on('end', () => {
        this.error(`_getPassword() -> client connection ended (ip: ${ip})`);
        if (!found) {
          return reject(new Error(ERROR_NO_RESPONSE_PASSWORD_GET));
        }
      });

      client.setEncoding('utf-8');
    });
  }

  /**
   * Wraps _getPassword with an interval, interval is aborted when password is retrieved, or after a timeout occurs.
   * @param {string} ip
   * @returns {Promise<unknown>}
   */
  async _getPasswordOnInterval(ip) {
    return new Promise((resolve, reject) => {
      this._getPasswordInterval = setInterval(() => {
        this._getPassword(ip)
          .then(password => {
            this.log('_getPasswordOnInterval() -> got password', password);
            clearInterval(this._getPasswordInterval);
            clearTimeout(this._getPasswordTimeout);
            return resolve(password);
          })
          .catch(err => {
            this.error('_getPasswordOnInterval() -> error', err);
            if (err.code === ERROR_CODE_CONN_REFUSED) {
              return reject(new Error(ERROR_IN_USE)); // Only abort if device is in use
            }
          });
      }, GET_PASSWORD_INTERVAL);

      this._getPasswordTimeout = setTimeout(() => {
        clearInterval(this._getPasswordInterval);
        clearTimeout(this._getPasswordTimeout);
        this.log('_getPasswordOnInterval() -> timeout');
        return reject(new Error(ERROR_GET_PASSWORD_TIMEOUT));
      }, GET_PASSWORD_INTERVAL_TIMEOUT);
    });
  }

  /**
   * Maps roomba object to Homey device object.
   * @param {Object} device
   * @returns {{data: {auth: {username: *}, ip: *, name: *, mac: *}, name: *}}
   * @private
   */
  _mapRoombaToDeviceObject(device) {
    return {
      name: device.robotname,
      data: {
        mac: device.mac,
      },
      store: {
        ip: device.ip, // Store ip in store
        auth: {
          username: device.username,
        },
      },
    };
  }
}

module.exports = Roomba980Driver;
