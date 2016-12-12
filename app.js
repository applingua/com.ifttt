'use strict';

const Log = require('homey-log').Log;

const request = require('request');

let homeyCloudID = undefined;

/**
 * Fetch homeyCloudId and registered triggers
 * and actions. Start listening for flow events.
 */
module.exports.init = () => {

	console.log('com.ifttt running...');

	// Check if there is still some data left from the old IFTTT app
	if (Homey.manager('settings').get('url') || Homey.manager('settings').get('secret')
		|| Homey.manager('settings').get('id') || Homey.manager('settings').get('key')) {

		Homey.manager('settings').unset('url');
		Homey.manager('settings').unset('secret');
		Homey.manager('settings').unset('id');
		Homey.manager('settings').unset('key');

		console.log('Update from older version, show notification');

		// Push notification to show user changes to IFTTT app
		Homey.manager('notifications').createNotification({
			excerpt: __('general.major_update_notification')
		});
	}

	// Fetch homey cloud id
	Homey.manager('cloud').getHomeyId((err, homeyId) => {
		if (!err && homeyId) {

			// Save homey cloud id
			homeyCloudID = homeyId;

			Homey.manager('settings').set('homeyCloudID', homeyId);

			// Fetch actions and triggers already registered
			registerTriggers();
			registerActions();

			// Listen for flow card updates and actions/triggers
			Homey.manager('flow').on('trigger.ifttt_event.update', registerTriggers);
			Homey.manager('flow').on('action.trigger_ifttt.update', registerActions);
			Homey.manager('flow').on('action.trigger_ifttt_with_data.update', registerActions);
			Homey.manager('flow').on('trigger.ifttt_event', triggerHandler);
			Homey.manager('flow').on('action.trigger_ifttt', actionHandler);
			Homey.manager('flow').on('action.trigger_ifttt_with_data', actionHandler);

		} else {
			console.error('Error: could not find Homey ID', err, homeyId);
		}
	});
};

/**
 * Incoming flow action event, register
 * it with IFTTT as an action trigger.
 * @param callback
 * @param args
 */
function actionHandler(callback, args) {

	console.log(`Homey.manager('flow').on('action.trigger_ifttt') -> ${args}`);

	// Make a call to register trigger with ifttt.athom.com
	registerFlowActionTrigger(args, err => {
		if (err) {

			console.error('Error registering flow action trigger, trying to refresh tokens', err);

			// Refresh access tokens
			refreshTokens(err => {
				if (err) {
					console.error('Error: refreshing tokens second time failed', err);

					if (callback) {
						return callback(`Error: refreshing tokens second time failed ${err}`, true);
					}
				}

				console.log('Register flow action trigger with args: ', args);

				// Retry registering action trigger
				registerFlowActionTrigger(args, (err, success) => {
					if (err) console.error('Error registering flow action trigger, abort', err);
					return callback(err, success);
				});
			});
		} else if (callback) {
			return callback(null, true);
		}
	});
}

/**
 * Handle flow trigger parsing, check
 * if events match and are valid.
 * @param callback
 * @param args
 * @param state
 */
function triggerHandler(callback, args, state) {

	console.log(`Homey.manager('flow').on('trigger.ifttt_event') -> args: ${args}, state: ${state}`);

	// Check for valid input
	if (args && args.hasOwnProperty('event')) {

		console.log(`Match flow_id and event result: ${args.event.toLowerCase() === state.flow_id.toLowerCase()}`);

		// Return success true if events match
		return callback(null, (args.event.toLowerCase() === state.flow_id.toLowerCase()));
	}

	console.error('Error: invalid trigger, no property for key "event"');

	// Return error callback
	return callback('Error: invalid trigger, no property for key "event"', false);
}

/**
 * Register all action flow cards
 * that are saved.
 */
function registerActions() {

	// Clean actions to prevent piling up
	module.exports.registeredActions = [];

	// Fetch all registered triggers
	Homey.manager('flow').getActionArgs('trigger_ifttt', (err, actions) => {
		if (!err && actions) {

			console.log(`registered Actions trigger_ifttt:`);

			// Loop over triggers
			actions.forEach(action => {

				// Check if all args are valid and present
				if (action && action.hasOwnProperty('event')) {

					// Register action
					module.exports.registeredActions.push(action.event);
				}
			});

			console.log(module.exports.registeredActions);
		} else if (err) {
			console.error(`Error: fetching registered Actions ${err}`);
		}
	});

	// Fetch all registered triggers
	Homey.manager('flow').getActionArgs('trigger_ifttt_with_data', (err, actions) => {
		if (!err && actions) {

			// Loop over triggers
			actions.forEach(action => {

				// Check if all args are valid and present
				if (action && action.hasOwnProperty('event')) {

					// Register action
					module.exports.registeredActions.push(action.event);
				}
			});

			console.log(module.exports.registeredActions);
		} else if (err) {
			console.error(`Error: fetching registered Actions ${err}`);
		}
	});
}

/**
 * Register all trigger flow cards
 * that are saved.
 */
function registerTriggers() {

	// Fetch all registered triggers
	Homey.manager('flow').getTriggerArgs('ifttt_event', (err, triggers) => {
		if (!err && triggers) {

			console.log(`registered Triggers:`);

			module.exports.registeredTriggers = [];

			// Loop over triggers
			triggers.forEach(trigger => {

				// Check if all args are valid and present
				if (trigger && trigger.hasOwnProperty('event')) {

					// Register trigger
					module.exports.registeredTriggers.push(trigger.event);
				}
			});

			console.log(module.exports.registeredTriggers);
		} else if (err) {
			console.error(`Error: fetching registered Triggers ${err}`);
		}
	});
}

/**
 * Makes a call to ifttt.athom.com to register a
 * flow action trigger event.
 * @param args
 * @param callback
 */
function registerFlowActionTrigger(args, callback) {

	console.log(`Register flow action trigger, event name: ${args.event}, 
	homey cloud id: ${homeyCloudID}, data: ${args.data}`);

	request.post({
		url: 'https://ifttt.athom.com/ifttt/v1/triggers/register/flow_action_is_triggered',
		json: {
			flowID: args.event,
			homeyCloudID: homeyCloudID,
			data: args.data || '',
		},
		headers: {
			Authorization: `Bearer ${Homey.manager('settings').get('ifttt_access_token')}`,
		},
	}, (error, response) => {
		if (!error && response.statusCode === 200) {
			console.log('IFTTT: succeeded to trigger Realtime API');
			if (callback) return callback(null, true);
		} else {
			console.error('IFTTT: failed to trigger Realtime API', error || response.statusCode !== 200);
			if (callback) return callback(`Failed to register flow action: ${(error) ? error : response.statusCode}`);
		}
	});
}

/**
 * Tries to refresh the stored access and refresh tokens.
 * @param callback
 */
function refreshTokens(callback) {

	// Check if all parameters are provided
	if (!Homey.manager('settings').get('ifttt_refresh_token') || !Homey.env.CLIENT_ID || !Homey.env.CLIENT_SECRET) {
		return callback('invalid_parameters_provided');
	}

	// Make request to api to fetch access_token
	request.post({
		url: 'https://ifttt.athom.com/oauth2/token',
		form: {
			client_id: Homey.env.CLIENT_ID,
			client_secret: Homey.env.CLIENT_SECRET,
			grant_type: 'refresh_token',
			refresh_token: Homey.manager('settings').get('ifttt_refresh_token'),
		},
	}, (error, response, body) => {
		if (error || response.statusCode !== 200) {

			console.error(`Error: fetching new tokens ${(error) ? error : response.statusCode}`);

			if (callback) return callback(`Error: refreshing tokens: ${(error) ? error : response.statusCode}`);
		} else {
			if (!error && body) {
				let parsedResult;
				try {
					parsedResult = JSON.parse(body);

					// Store new access tokens
					Homey.manager('settings').set('ifttt_access_token', parsedResult.access_token);
					Homey.manager('settings').set('ifttt_refresh_token', parsedResult.refresh_token);

					console.log('Stored new tokens');

					if (callback) return callback(null, true);
				} catch (err) {

					console.error('Error: parsing JSON response from refresh tokens', err);

					if (callback) return callback(`Error: parsing JSON response from refresh tokens ${err}`);
				}
			} else if (callback) return callback('Error: no body provided with refresh tokens');
		}
	});
}
