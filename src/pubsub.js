/*
Copyright (c) 2010,2011,2012,2013 Morgan Roderick http://roderick.dk
License: MIT - http://mrgnrdrck.mit-license.org

https://github.com/mroderick/PubSubJS
*/

/*jslint white:true, plusplus:true, stupid:true*/
/*global
	setTimeout,
	module,
	exports,
	define,
	require,
	window
*/

(function(root, factory) {
	'use strict';

	// CommonJS
	if (typeof exports === 'object' && module) {
		module.exports = factory();

	// AMD
	} else if (typeof define === 'function' && define.amd) {
		define(factory);
	// Browser
	} else {
		root.PubSub = factory();
	}
}((typeof window === 'object' && window) || this, function() {

	'use strict';

	var PubSub = {};

    /*
     * Serves as the map from topic names to subscribers.
     * Each subscriber is stored as {subscriber_token: handler}
     * The token for the subscriber is generated on subscribe.
     * The handler is the callback which will be executed on
     * a publish to the subscribed topic.
     */
	var subscribers = {}

    /*
     * This holds the list of subscribers who wish to
     * receive all messages, regardless of topic.
     */
    var global_subscribers = {};

    /*
     * Useful little function to check for object existence.
     * Returns true if object is neither null nor undefined.
     */
    var exists = function (x) {
        return x != null
    };

    /*
     * Creates token generators, which use a simple
     * increment by one method to generate tokens
     * from 0 onwards.
     *
     * Tokens take the form t_0, t_1, ...
     */
    function makeTokenGenerator() {
        var lastToken = -1;
        return function tokenGenerator () {
            return 't_' + (++lastToken);		
        }
    };

    /*
     * This is the actual token generator which will be used.
     */
    var tokenGenerator = makeTokenGenerator();

    /*
     * Return true if OBJ has any keys, otherwise false.
     */
	function hasKeys(obj) {
		var key;
		for (key in obj) {
			if (obj.hasOwnProperty(key)) {
				return true;
			}
		}
		return false;
	}

    /**
     * Returns a function that throws the passed exception.
     * This is for use as an argument in setTimeout for delayed exceptions.
     * @param {Object} ex: An Error object
     */
    function throwException(ex) {
        return function reThrowException() {
            throw ex;
        };
    }

    /**
     * Even if delivery to one subscriber fails, the rest should still
     * be attempted. This is the normal, asynchronous behavior, which
     * is used when PubSub.immediateExceptions is set to false.
     */
    function callSubscriberWithDelayedExceptions(
            subscriber, topic, data, uid) {

        try {
            subscriber( topic, data, uid);
        } catch(ex) {
            setTimeout( throwException( ex ), 0);
        }
    }

    /**
     * This is for debugging use only.
     * It will cause immediate failure, preventing delivery to all other
     * subscribers, but it will also enable stack traces in dev tools.
     * This is used when PubSub.immediateExceptions is set to true.
     */
    function callSubscriberWithImmediateExceptions(
            subscriber, topic, data, uid) {

        subscriber(topic, data, uid);
    }

    /**
     * Deliver topics to all subscribers of the matched topic.
     * To be clear, this simply involves looking up their callbacks
     * by their subscriber tokens and executing each.
     */
	function deliverMessage(originalTopic, matchedTopic, data, uid, debug) {
        var callSubscriber, subscriber_list, subscriber;

        /* if there are no subscribers for this topic, simply return */
		if (!subscribers.hasOwnProperty(matchedTopic)) {
			return;
		}

        /* raise exceptions immediately if in debug mode */
        if (debug) {
            callSubscriber = callSubscriberWithImmediateExceptions;
        } else {
            callSubscriber = callSubscriberWithDelayedExceptions;
        }

        subscriber_list = subscribers[matchedTopic];
		for (subscriber in subscriber_list) {
            /* ignore inherited properties */
			if (subscriber_list.hasOwnProperty(subscriber)) {
                /*
                 * Notice that we pass the original topic but this is
                 * being sent to subscribers of the matched topic.
                 */
				callSubscriber(subscriber_list[subscriber],
                        originalTopic, data, uid);
			}
		}
	};

    /**
     * Return a function that delivers a message to a topic and
     * all parent topics in the '.' delimited hierarchy.
     */
	function createDeliveryFunction(topic, data, uid, debug) {
		return function deliverNamespaced() {
            var topic_match, position;

            /* set initial position */
			position = topic.lastIndexOf('.');

            /* deliver message to original channel */
			deliverMessage(topic, topic, data, uid, debug);

			/* trim the hierarchy and deliver the message to each level */
			while (position !== -1) {
				topic_match = topic.substr(0, position);
				deliverMessage(topic, topic_match, data);
				position = topic_match.lastIndexOf('.');
			}
		};
	}

    /**
     * Return true if anyone is subscribed to this topic,
     * at any level in the '.' delimited hierarchy.
     *
     * This does not include global subscribers.
    **/
	function topicHasSubscribers(topic) {
		var topic    = String(topic);
		var position = topic.lastIndexOf('.');
		var found    = Boolean(subscribers.hasOwnProperty(topic) &&
                               hasKeys(subscribers[topic]));

		while (!found && position !== -1) {
			topic = topic.substr(0, position);
			found = Boolean(subscribers.hasOwnProperty(topic) &&
                            hasKeys(subscribers[topic]));
			position = topic.lastIndexOf('.');
		}

		return found;
	}

    /**
     * Publish a message to the given topic with the given data.
     *
     * This will also publish the message to all global subscribers
     * regardless of the topic.
     *
     * Returns false if the topic has no subscribers (not including
     * global subscribers), otherwise true.
    **/
	function publish(topic, data, uid, sync, debug) {
        var deliver, key;

        /* broadcast all messages to global subscribers */
        for (key in global_subscribers) {
            //Delivery to global listeners
            if (global_subscribers.hasOwnProperty(key)) {			
                global_subscribers[key](topic,data,uid);		
            }
        }

        /* don't bother with anything else if no one is subscribed */
		if (!topicHasSubscribers(topic)) {
			return false;
		}

        /* deliver the message, either synchronously or asynchronously */
		deliver = createDeliveryFunction(topic, data, uid, debug);
        sync ? deliver() : setTimeout(deliver, 0);

        /* message delivery successfully attempted for each subscriber */
		return true;
	}

    /*
     * ------------------------------------------------------------------------
     * Attach public functions to the PubSub object
     * ------------------------------------------------------------------------
     */

	/**
	 *	PubSub.publish(topic[, data]) -> Boolean
	 *	@param {String} topic: The topic to publish to
	 *	@param {Object} data:  The data to pass to subscribers
     *
	 *	Publishes the the topic,
     *	passing the data to it's subscribers.
	**/
	PubSub.publish = function(topic, data, uid) {
		return publish(topic, data, uid, false,
                PubSub.immediateExceptions );
	};

	/**
	 *	PubSub.publishSync(topic[, data]) -> Boolean
	 *	@param {String} topic: The topic to publish to
	 *	@param {Object} data:  The data to pass to subscribers
     *
	 *	Publishes the the topic synchronously,
     *	passing the data to it's subscribers.
	**/
	PubSub.publishSync = function(topic, data, uid) {
		return publish(topic, data, uid, true,
                PubSub.immediateExceptions);
	};

	/**
	 *	PubSub.subscribe(topic, func) -> String
	 *	@param {String} topic:  The topic to subscribe to.
	 *	@param {Function} func: The function to call when a new topic
     *	                        is published.
     *
	 *	Subscribes the passed function to the passed topic.
     *	Every returned token is unique and should be stored if
	 *	you need to unsubscribe.
	**/
	PubSub.subscribe = function(topic, func) {
        var token;

		if (typeof func !== 'function') {
			return false;
		}

		/* topic is not registered yet, so newly store it as a key */
		if (!subscribers.hasOwnProperty(topic)) {
			subscribers[topic] = {};
		}

		token = tokenGenerator();
		subscribers[topic][token] = func;

		/* return token for unsubscribing */
		return token;
	};

    /**
     * Subscribe to all messages, regardless of topic.
     * This is primarily useful for logging/debugging.
     * @param {Function} func: callback to execute on publishes.
    **/
	PubSub.subscribeAll = function(func) {
		var token = tokenGenerator();
		global_subscribers[token] = func;
	};

	/**
	 *	PubSub.unsubscribe( tokenOrFunction ) -> String | Boolean
	 *  @param {String|Function} tokenOrFunction: The token of the function
     *    to unsubscribe or func passed in on subscribe
     *
     *  Unsubscribes a specific subscriber from a specific topic using the
     *  unique token or if using Function as argument, it will remove all
     *  subscriptions with that function.
     *
     *  @returns
     *  (1) false if no subscriptions were removed
     *  (2) true if a function was passed, found in the list of subscriptions,
     *      and removed
     *  (3) the token, if the token was passed and unsubscribe was successful
	**/
	PubSub.unsubscribe = function(tokenOrFunction) {
		var isToken, result, subscriber, topic, token, result;

        result = false;
        isToken = typeof tokenOrFunction === 'string';

		for (topic in subscribers) {
			if (subscribers.hasOwnProperty(topic)) {
				if (isToken && subscribers[topic][tokenOrFunction]) {
					delete subscribers[topic][tokenOrFunction];
					result = tokenOrFunction;
					/* tokens are unique, so we can just stop here */
					break;
				} else if (!isToken) {
					for (token in topic) {
						if (topic.hasOwnProperty(token) &&
                            topic[token] === tokenOrFunction) {
							delete topic[token];
							result = true;
						}
					}
				}
			}
		}

		return result;
	};

    /* will be attached to root */
	return PubSub;
}));
