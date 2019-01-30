'use strict';

const dgram = require('dgram');
const EventEmitter = require('events');

const MESSAGE = Buffer.from('irobotmcs');
const THIRTY_SECONDS = 30 * 1000;

/**
 * This class attempts to find new Roombas on the network.
 */
class Finder extends EventEmitter {
    constructor(props) {
        super(props);

        this._roombas = {};
        this.start();
    }

    start() {
        this._listen();

        // When listening has started broadcast and broadcast every 30 seconds afterwards
        this.server.on('listening', () => {
            this._broadcast();
            this.broadcastInterval = setInterval(this._broadcast.bind(this), THIRTY_SECONDS);
        });
    }

    _restart(reason) {
        if (reason) console.error(reason);
        clearInterval(this.broadcastInterval);
        this.server.close();

        this.start();
    }

    _listen() {
       this.server = dgram.createSocket({
           type: 'udp4',
           reuseAddr: true
       });

       this.server.on('error', this._restart.bind(this));
       this.server.on('message', this._onMessage.bind(this));
       this.server.bind(5678);
    }

    _broadcast() {
        /*
        Broadcast the message to the entire internal network, regardless of subnet.
        Be wary, the Roomba responds with a broadcast within its own subnet, so you do
        have to be in the same subnet to get a result.
        */
        this.server.setBroadcast(true);
        this.server.send(MESSAGE, 0, MESSAGE.length, 5678, '255.255.255.255');
    }

    _onMessage(message) {
        const parsed = this._parseMessage(message);
        if (!parsed) return;
        this._roombas[parsed.robotname] = parsed;
    }

    _parseMessage(message) {
        // Ignore the return of our own message from the router
        if (message.toString() === 'irobotmcs') return;

        try {
            const parsed = JSON.parse(message);
            const {hostname} = parsed;
            const splitHostname = hostname.split('-');

            // First part indicates whether this is a Roomba, second part is the username
            if (splitHostname[0] !== 'Roomba') return;
            const username = splitHostname[1];

            return {
                ...parsed,
                username
            }
        } catch (e) {
            console.error(e);
        }
    }

    get roombas() {
        return Object.values(this._roombas);
    }
}

module.exports = new Finder();
