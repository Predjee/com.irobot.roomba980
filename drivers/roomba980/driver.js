'use strict';

const Homey = require('homey');
const tls = require('tls');
const finder = require('./finder');

class Roomba980Driver extends Homey.Driver {
    /**
     * Get the password of a Roomba.
     * @param  {string}  ip IP address of the Roomba.
     * @return {Promise} A promise resolving with the password, or rejecting if
     * it could not be retrieved.
     */
    async getPassword(ip) {
        return new Promise((resolve, reject) => {
            let client = tls.connect(8883, ip, {
                rejectUnauthorized: false
            });

            let found = false;

            let timeout = setTimeout(() => {
                client.end();
            }, 5000);

            /*
            This hex code results in the Roomba relaying its password back to us.
            Legacy was undocumented so we're not sure why it's this string specifically.
             */
            client.once('secureConnect', () => {
                client.write(Buffer.from('f005efcc3b2900', 'hex'));
            });

            client.on('error', (e) => {
                if (e.code === 'ECONNREFUSED') {
                    // Someone else is already connected.
                    reject(e);

                    clearTimeout(timeout);
                    client.end();
                }
            });

            let sliceIndex = 13;

            client.on('data', (data) => {
                /*
                 UDP package of size 2 indicates a different data format for the password
                 so we adjust the slicing index
                 */
                if (data.length === 2) {
                    sliceIndex = 9;
                }
                /*
                 UDP packages of length 7 and higher indicate the password has been sent to
                 us. Parse the password by creating a buffer and slicing it at the determined
                 slicing index. Turn the result into a string.
                 */
                else if (data.length > 7) {
                    found = true;

                    clearTimeout(timeout);
                    client.end();

                    resolve(Buffer.from(data).slice(sliceIndex).toString());
                }
            });

            client.on('end', () => {
                if (!found) reject(new Error('Roomba didn\'t respond'));
            });

            client.setEncoding('utf-8');
        });
    }

    onPair(socket) {
        socket.on('list_devices', (data, callback) => {
            callback(null, finder.roombas.map(roomba => this._roombaToDevice(roomba)));
        });

        socket.on('check', (data, callback) => {
            this.getPassword(data.ip)
                .then((password) => {
                    callback(null, {
                        status: 'success',
                        data: password
                    });
                })
                .catch((err) => {
                    if (err.code === 'ECONNREFUSED') {
                        callback(null, {
                            status: 'in_use',
                            data: null
                        });
                    } else {
                        callback(null, {
                            status: 'failure',
                            data: null
                        });
                    }
                });
        });
    }

    _roombaToDevice(device) {
        return {
            name: device.robotname,
            data: {
                mac: device.mac,
                ip: device.ip,
                name: device.robotname,
                auth: {
                    username: device.username,
                    // The password is later discovered in add_roomba.
                    password: null
                }
            }
        };
    }
}

module.exports = Roomba980Driver;
