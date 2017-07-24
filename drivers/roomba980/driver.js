'use strict';

const Homey = require('homey');

const tls = require('tls');

const RoombaFinder = require('./finder');


class Roomba980Driver extends Homey.Driver {
    onInit() {
        this.finder = new RoombaFinder();
    }

    async getPassword(ip) {
        return new Promise((resolve, reject) => {
            let client = tls.connect(8883, ip, {
                rejectUnauthorized: false
            });

            let found = false;

            let timeout = setTimeout(() => {
                client.end();
                reject(new Error('Roomba took too long to respond!'));
            }, 5000);

            client.once('secureConnect', () => {
                this.log('Sending auth request to Roomba.');
                client.write(new Buffer('f005efcc3b2900', 'hex'));
            });

            client.on('error', (e) => {
                if (e.code === 'ECONNREFUSED') {
                    // Someone else is already connected.
                    client.end();
                    reject(e);
                    clearTimeout(timeout);
                    return;
                }
                this.log(e);
            });

            let sliceFrom = 13;

            client.on('data', (data) => {
                this.log('Got data back from the Roomba: ' + data);

                if (data.length === 2) {
                    // The Roomba somehow indicates that it's going to send the
                    // data differently. We prepare by adjusting sliceFrom
                    // accordingly.
                    sliceFrom = 9;
                    return;
                }

                if (data.length <= 7) {
                    // Other data which we do not need.
                } else {
                    clearTimeout(timeout);
                    client.end();
                    found = true;
                    resolve(new Buffer(data).slice(sliceFrom).toString());
                }

                client.end();
            });

            client.on('end', () => {
                this.log('end');
                if (!found) {
                    reject(new Error('Roomba took too long to respond!'));
                }
            });

            client.setEncoding('utf-8');
        });
    }

    onPair(socket) {
        socket.on('check', (data, callback) => {
            this.getPassword(data.ip)
                .then((password) => {
                    callback(null, {
                        status: 'success',
                        data: password
                    });
                })
                .catch((err) => {
                    this.log('Failed to retrieve auth details: ' + err);
                    if (err.code === 'ECONNREFUSED') {
                        callback(null, {
                            status: 'in_use',
                            data: null
                        });

                        return;
                    }

                    callback(null, {
                        status: 'failure',
                        data: null
                    });
                });
        });

        socket.on('list_devices', (data, callback) => {
            this.finder.findRoomba()
                .then((data) => {
                    this.log(`Found Roomba with IP = ${data.ip} and MAC = ${data.mac}.`);

                    // The dorita980 lib only gives back one device.
                    let devices = [
                        {
                            name: data.robotname,
                            data: {
                                mac: data.mac,
                                ip: data.ip,
                                name: data.name,
                                auth: {
                                    username: data.blid,
                                    // The password is later discovered in add_roomba.
                                    password: null
                                }
                            }
                        }
                    ];

                    callback(null, devices);
                })
                .catch((err) => {
                    this.log(err);
                    callback(err);
                    return;
                });
        });
    }
}
module.exports = Roomba980Driver;
