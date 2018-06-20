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

        this.roombas = [];

        this.broadcastInterval = setInterval(this.sendBroadcast.bind(this), 60000); // Every minute.

        this.refreshInterval = setInterval(() => {
            const twoMinutesAgo = new Date().getTime() - 120000;

            this.roombas = this.roombas.filter((roomba) => roomba.lastSeen < twoMinutesAgo);
        }, 60000); // Filter away unseen Roombas every minute, if they weren't seen for two minutes.

        this.startListening();
    }

    startListening() {
        return new Promise((resolve, reject) => {
            if (this.listening) {
                return resolve();
            }

            this.listenServer = dgram.createSocket({
                type: 'udp4',
                reuseAddr: true
            });

            this.listenServer.on('error', (error) => {
                this.listenServer.close(() => {
                    this.listening = false;
                    this.startListening();
                });
            });

            this.listenServer.on('message', this.onMessage.bind(this));

            this.listenServer.bind(5678, () => {
                this.listening = true;
            });
        });
    }

    sendBroadcast() {
        if (!this.listening) {
            return;
        }

        const message = new Buffer('irobotmcs');

        this.listenServer.setBroadcast(true);

        this.listenServer.send(message, 0, message.length, 5678, '255.255.255.255');
    }

    async onMessage(message) {
        const roomba = await this.parseMessage(message);

        if (roomba === null) {
            // No Roomba was found.
            return;
        }

        if (this.roombas.find((r) => r.mac === roomba.mac)) {
            this.roombas = this.roombas.filter((r) => {
                if (r.mac === roomba.mac) {
                    r.lastSeen = new Date().getTime();
                }
            });

            return;
        }

        this.roombas.push({
            ...roomba,
            lastSeen: new Date().getTime()
        });
    }

    async parseMessage(message) {
        try {
            const parsed = JSON.parse(message);
            const {ip, hostname} = parsed;

            if (hostname.split('-')[0] !== 'Roomba') {
                return null;
            }

            const blid = hostname.split('-')[1];

            const mac = await Homey.ManagerArp.getMAC(ip);

            return {
                ...parsed,
                mac
            };
        } catch (e) {
            return null;
        }
    }

    getRoombas() {
        return this.roombas;
    }
}

module.exports = new RoombaFinder();
