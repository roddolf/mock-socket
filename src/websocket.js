import lengthInUtf8Bytes from './helpers/byte-length';
import urlVerification from './helpers/url-verification';
import protocolVerification from './helpers/protocol-verification';
import delay from './helpers/delay';
import EventTarget from './event/target';
import networkBridge from './network-bridge';
import { CLOSE_CODES, ERROR_PREFIX } from './constants';
import logger from './helpers/logger';
import { createEvent, createMessageEvent, createCloseEvent } from './event/factory';
import { closeWebSocketConnection, failWebSocketConnection } from './algorithms/close';

/*
* The main websocket class which is designed to mimick the native WebSocket class as close
* as possible.
*
* https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
*/
class WebSocket extends EventTarget {
  constructor(url, protocols) {
    super();

    this.url = urlVerification(url);
    protocols = protocolVerification(protocols);
    this.protocol = protocols[0] || '';

    this.binaryType = 'blob';
    this.readyState = WebSocket.CONNECTING;

    const server = networkBridge.attachWebSocket(this, this.url);

    /*
    * This delay is needed so that we dont trigger an event before the callbacks have been
    * setup. For example:
    *
    * var socket = new WebSocket('ws://localhost');
    *
    * // If we dont have the delay then the event would be triggered right here and this is
    * // before the onopen had a chance to register itself.
    *
    * socket.onopen = () => { // this would never be called };
    *
    * // and with the delay the event gets triggered here after all of the callbacks have been
    * // registered :-)
    */
    delay(function delayCallback() {
      if (server) {
        if (
          server.options.verifyClient &&
          typeof server.options.verifyClient === 'function' &&
          !server.options.verifyClient()
        ) {
          this.readyState = WebSocket.CLOSED;

          logger(
            'error',
            `WebSocket connection to '${this.url}' failed: HTTP Authentication failed; no valid credentials available`
          );

          networkBridge.removeWebSocket(this, this.url);
          this.dispatchEvent(createEvent({ type: 'error', target: this }));
          this.dispatchEvent(createCloseEvent({ type: 'close', target: this, code: CLOSE_CODES.CLOSE_NORMAL }));
        } else {
          if (server.options.selectProtocol && typeof server.options.selectProtocol === 'function') {
            const selectedProtocol = server.options.selectProtocol(protocols);
            const isFilled = selectedProtocol !== '';
            const isRequested = protocols.indexOf(selectedProtocol) !== -1;
            if (isFilled && !isRequested) {
              this.readyState = WebSocket.CLOSED;

              logger('error', `WebSocket connection to '${this.url}' failed: Invalid Sub-Protocol`);

              networkBridge.removeWebSocket(this, this.url);
              this.dispatchEvent(createEvent({ type: 'error', target: this }));
              this.dispatchEvent(createCloseEvent({ type: 'close', target: this, code: CLOSE_CODES.CLOSE_NORMAL }));
              return;
            }
            this.protocol = selectedProtocol;
          }
          this.readyState = WebSocket.OPEN;
          this.dispatchEvent(createEvent({ type: 'open', target: this }));
          server.dispatchEvent(createEvent({ type: 'connection' }), server, this);
        }
      } else {
        this.readyState = WebSocket.CLOSED;
        this.dispatchEvent(createEvent({ type: 'error', target: this }));
        this.dispatchEvent(createCloseEvent({ type: 'close', target: this, code: CLOSE_CODES.CLOSE_NORMAL }));

        logger('error', `WebSocket connection to '${this.url}' failed`);
      }
    }, this);
  }

  get onopen() {
    return this.listeners.open;
  }

  get onmessage() {
    return this.listeners.message;
  }

  get onclose() {
    return this.listeners.close;
  }

  get onerror() {
    return this.listeners.error;
  }

  set onopen(listener) {
    delete this.listeners.open;
    this.addEventListener('open', listener);
  }

  set onmessage(listener) {
    delete this.listeners.message;
    this.addEventListener('message', listener);
  }

  set onclose(listener) {
    delete this.listeners.close;
    this.addEventListener('close', listener);
  }

  set onerror(listener) {
    delete this.listeners.error;
    this.addEventListener('error', listener);
  }

  /*
  * Transmits data to the server over the WebSocket connection.
  *
  * https://developer.mozilla.org/en-US/docs/Web/API/WebSocket#send()
  */
  send(data) {
    if (this.readyState === WebSocket.CLOSING || this.readyState === WebSocket.CLOSED) {
      throw new Error('WebSocket is already in CLOSING or CLOSED state');
    }

    const messageEvent = createMessageEvent({
      type: 'message',
      origin: this.url,
      data
    });

    const server = networkBridge.serverLookup(this.url);

    if (server) {
      delay(() => {
        server.dispatchEvent(messageEvent, data);
      }, server);
    }
  }

  /*
   * https://html.spec.whatwg.org/multipage/web-sockets.html#dom-websocket-close
   */
  close(code, reason) {
    if (code !== undefined) {
      if (typeof code !== 'number' || (code !== 1000 && (code < 3000 || code > 4999))) {
        throw new TypeError(
          `${ERROR_PREFIX.CLOSE_ERROR} The code must be either 1000, or between 3000 and 4999. ${code} is neither.`
        );
      }
    }

    if (reason !== undefined) {
      const length = lengthInUtf8Bytes(reason);

      if (length > 123) {
        throw new SyntaxError(`${ERROR_PREFIX.CLOSE_ERROR} The message must not be greater than 123 bytes.`);
      }
    }

    if (this.readyState === WebSocket.CLOSING || this.readyState === WebSocket.CLOSED) {
      return;
    }

    if (this.readyState === WebSocket.CONNECTING) {
      failWebSocketConnection(this, code, reason);
    } else {
      closeWebSocketConnection(this, code, reason);
    }
  }
}

WebSocket.CONNECTING = 0;
WebSocket.OPEN = 1;
WebSocket.CLOSING = 2;
WebSocket.CLOSED = 3;

export default WebSocket;
