'use strict';

const dgram = require('dgram');

const Homey = require('homey');

/**
 * This class attempts to find new Roombas on the network.
 */
class RoombaFinder extends Homey.SimpleClass {
    constructor() {
        super();

        this.listenServer = null;
        this.listening = false;
    }

    /**
     * Find any Roomba 980.
     *
     * @param {function} callback - Callback to call when a single robot is found.
     * @return {Promise} Promise which resolves with data about Roombas.
     */
    async findRoomba(callback) {
        return new Promise((resolve, reject) => {
            const roombas = [];

            const nextStep = () => {
                this.listenServer = dgram.createSocket('udp4');

                const timeout = setTimeout(() => {
                    this.listenServer.close(() => {
                        this.listening = false;

                        resolve(roombas);
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

                                    roombas.push(parsed);

                                    if (callback) {
                                        callback(parsed);
                                    }
                                })
                                .catch(this.error.bind(this, 'findRoomba -> getMAC'));
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
