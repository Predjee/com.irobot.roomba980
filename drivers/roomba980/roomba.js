'use strict';

const EventEmitter = require('events').EventEmitter;
const mqtt = require('mqtt');

/**
 * Interface to a Roomba 980.
 * @class Roomba
 */
class Roomba extends EventEmitter {

    /**
     * Set up a new connection to a Roomba 980.
     * @param  {string} username Username to authenticate with.
     * @param  {string} password Password to authenticate with.
     * @param  {string} host     Hostname / IP address of the Roomba.
     * @constructor
     * @memberof Roomba#
     */
    constructor(username, password, host) {
        super();

        this._client = mqtt.connect(`tls://${host}`, {
            port: 8883,
            clientId: username,
            rejectUnauthorized: false,
            protocolId: 'MQTT',
            protocolVersion: 4,
            clean: false,
            username: username,
            password: password
        });

        // We don't need reconnecting.
        this._client._clearReconnect();

        this._client._reconnect = () => {};

        this._state = {};

        this._client.on('error', e => {
            this.emit('error', e);
        });

        this._client.on('connect', () => {
            this.emit('connected');
        });

        this._client.on('offline', () => {
            this.emit('offline');
        });

        this._client.on('packetreceive', packet => {
            if (!packet.payload) {
                return;
            }

            try {
                const msg = JSON.parse(packet.payload.toString());

                this._state = Object.assign(this._state, msg.state.reported);

                this.emit('state', this._state);
            } catch (e) {
                // Probably a message we don't understand, so we skip it.
            }
        });
    }

    /**
     * The current roomba state.
     * @memberof Roomba#
     */
    get state() {
        return this._state;
    }

    /**
     * Make an API call to the Roobma 980.
     * @param  {string}  topic   Topic of the command.
     * @param  {string}  command The command itself.
     * @return {Promise}         A promise resolving when the command succeeded,
     * or rejecting when it failed.
     */
    async _call(topic, command) {
        return new Promise((resolve, reject) => {
            let cmd = {
                command,
                time: Date.now() / 1000 | 0,
                initiator: 'localApp'
            };

            if (topic === 'delta') {
                cmd = {
                    state: command
                };
            }

            this._client.publish(topic, JSON.stringify(cmd), e => {
                if (e) {
                    return reject(e);
                }

                resolve();
            });
        });
    }

    /**
     * Start cleaning.
     * @method start
     * @memberof Roomba#
     * @return {Promise} A promise resolving when the command succeeded, or
     * rejecting when it failed.
     */
    async start() {
        return this._call('cmd', 'start');
    }

    /**
     * Pause with cleaning.
     * @method pause
     * @memberof Roomba#
     * @return {Promise} A promise resolving when the command succeeded, or
     * rejecting when it failed.
     */
    async pause() {
        return this._call('cmd', 'pause');
    }

    /**
     * Stop cleaning.
     * @method stop
     * @memberof Roomba#
     * @return {Promise} A promise resolving when the command succeeded, or
     * rejecting when it failed.
     */
    async stop() {
        return this._call('cmd', 'stop');
    }

    /**
     * Resume cleaning.
     * @method resume
     * @memberof Roomba#
     * @return {Promise} A promise resolving when the command succeeded, or
     * rejecting when it failed.
     */
    async resume() {
        return this._call('cmd', 'resume');
    }

    /**
     * Go to the dock.
     * @method dock
     * @memberof Roomba#
     * @return {Promise} A promise resolving when the command succeeded, or
     * rejecting when it failed.
     */
    async dock() {
        return this._call('cmd', 'dock');
    }

    /**
     * End the connection with the Roomba 980.
     * @method end
     * @memberof Roomba#
     */
    end() {
        const forceDisconnectTimeout = setTimeout(() => {
            console.log('Forcing a disconnect.');
            if (this._client.stream) {
                console.log('.stream exists; we\'re destroying it.');

                this._client.stream.removeAllListeners();

                this._client.stream.end();
            }
        }, 2000);

        this._client.end(() => {
            console.log('end() callback; we\'re done here.');

            this._client.stream.removeAllListeners();

            this._client.stream.end();

            clearTimeout(forceDisconnectTimeout);
        });

        this._client.removeAllListeners();
    }
}

module.exports = Roomba;
