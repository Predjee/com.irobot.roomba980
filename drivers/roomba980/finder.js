'use strict';

const dgram = require('dgram');

const Homey = require('homey');

class RoombaFinder {
    constructor() {
        this.listenServer = null;
        this.listening = false;
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

                            Homey.ManagerArp.getMAC(parsed.ip)
                                .then((mac) => {
                                    parsed.mac = mac;

                                    resolve(parsed);
                                })
                                .catch((err) => {
                                    reject(err);
                                });
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
}

module.exports = RoombaFinder;
