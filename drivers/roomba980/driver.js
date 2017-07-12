'use strict';

const Homey = require('homey');

const tls = require('tls');
const dgram = require('dgram');


class Roomba980Driver extends Homey.Driver {
    onInit() {
        this.listening = false;
        this.listenServer = null;
    }

    async findRoomba() {
        return new Promise((resolve, reject) => {
            let nextStep = () => {
                this.listenServer = dgram.createSocket('udp4');

                let timeout = setTimeout(() => {
                    reject(new Error('Could not find your roomba!'));
                    this.listenServer.close(() => {
                        this.listening = false;
                    });
                }, 10000);

                this.listenServer.on('error', (err) => {
                    this.listenServer.close();
                    this.listening = false;

                    reject(err);
                });

                this.listenServer.on('message', (msg) => {
                    try {
                        let parsed = JSON.parse(msg);

                        if (parsed.hostname && parsed.ip && parsed.hostname.split('-')[0] === 'Roomba') {
                            this.listenServer.close();
                            this.listening = false;

                            clearTimeout(timeout);

                            // The username is part of the hostname.
                            // Roomba-xyz --> username is xyz.
                            parsed.blid = parsed.hostname.split('-')[1];

                            resolve(parsed);
                        }
                    } catch (e) {
                        // Message is invalid, probably some other happy service
                        // trying to reply to your query.
                        //
                        // We could log this, but that would mean spamming the
                        // console.
                    }
                });

                this.listenServer.bind(5678, () => {
                    this.listeningg = true;

                    const message = new Buffer('irobotmcs');

                    this.listenServer.setBroadcast(true);

                    this.listenServer.send(message, 0, message.length, 5678, '255.255.255.255');
                });
            };

            if (this.listening) {
                this.listenServer.close(nextStep);

                this.listening = false;
            } else {
                nextStep();
            }
        });
    }

    async getPassword(ip) {
        return new Promise((resolve, reject) => {
            let client = tls.connect(8883, ip, {
                rejectUnauthorized: false
            });

            let found = false;

            let timeout = setTimeout(() => {
                reject(new Error('Roomba took too long to respond!'));
            }, 5000);

            client.once('secureConnect', () => {
                this.log('Sending auth request to Roomba.');
                client.write(new Buffer('f005efcc3b2900', 'hex'));
            });

            client.on('error', (e) => {
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
                    callback(null, {
                        status: 'failure',
                        data: null
                    });
                });
        });

        socket.on('list_devices', (data, callback) => {
            this.findRoomba()
                .then((data) => {
                    data.id = data.hostname;

                    data.auth = {
                        username: data.blid,
                        password: null
                    };

                    // The dorita980 lib only gives back one device.
                    let devices = [
                        {
                            name: data.robotname,
                            data: data
                        }
                    ];

                    this.log(devices);

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
