"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const schemas_1 = require("@broid/schemas");
const utils_1 = require("@broid/utils");
const Promise = require("bluebird");
const uuid = require("uuid");
const R = require("ramda");
class Parser {
    constructor(serviceName, serviceID, logLevel) {
        this.serviceID = serviceID;
        this.generatorName = serviceName;
        this.logger = new utils_1.Logger('parser', logLevel);
    }
    validate(event) {
        this.logger.debug('Validation process', { event });
        const parsed = utils_1.cleanNulls(event);
        if (!parsed || R.isEmpty(parsed)) {
            return Promise.resolve(null);
        }
        if (!parsed.type) {
            this.logger.debug('Type not found.', { parsed });
            return Promise.resolve(null);
        }
        return schemas_1.default(parsed, 'activity')
            .then(() => parsed)
            .catch((err) => {
            this.logger.error(err);
            return null;
        });
    }
    parse(event) {
        this.logger.debug('Normalize process', { event });
        const normalized = utils_1.cleanNulls(event);
        if (!normalized || R.isEmpty(normalized)) {
            return Promise.resolve(null);
        }
        const activitystreams = this.createActivityStream(normalized);
        const actor = {
            id: R.path(['author', 'id'], normalized),
            name: R.path(['author', 'name'], normalized),
            type: 'Person',
        };
        activitystreams.actor = actor;
        if (R.path(['channel', 'is_mention'], normalized)) {
            activitystreams.target = R.assoc('type', 'Group', actor);
        }
        else {
            activitystreams.target = actor;
        }
        return Promise.map(normalized.attachments, (attachment) => {
            const url = R.prop('url', attachment);
            if (url) {
                return utils_1.fileInfo(url, this.logger).then((infos) => R.assoc('mimetype', infos.mimetype, attachment));
            }
            return null;
        })
            .then(R.reject(R.isNil))
            .filter((attachment) => attachment.mimetype !== '')
            .then((attachments) => {
            const count = R.length(attachments);
            if (count === 1) {
                activitystreams.object = {
                    content: normalized.text,
                    id: normalized.id || this.createIdentifier(),
                    mediaType: attachments[0].mimetype,
                    type: attachments[0].type,
                    url: attachments[0].url,
                };
            }
            else if (count > 1) {
                activitystreams.object = {
                    attachment: R.map((attachment) => ({
                        mediaType: attachment.mimetype,
                        type: attachment.type,
                        url: attachment.url,
                    }), attachments),
                    content: normalized.content || '',
                    id: normalized.mid || this.createIdentifier(),
                    type: 'Note',
                };
            }
            return activitystreams;
        })
            .then((as2) => {
            if (!as2.object && !R.isEmpty(normalized.text)) {
                as2.object = {
                    content: normalized.text,
                    id: normalized.id || this.createIdentifier(),
                    type: 'Note',
                };
            }
            if (as2.object && normalized.hashtags
                && !R.isEmpty(normalized.hashtags)) {
                as2.object.tag = R.map((tag) => ({ id: tag.text, name: tag.text, type: 'Object' }), normalized.hashtags);
            }
            return as2;
        });
    }
    normalize(raw) {
        this.logger.debug('Event received to normalize', { raw });
        const event = utils_1.cleanNulls(raw);
        if (!event || R.isEmpty(event)) {
            return Promise.resolve(null);
        }
        const extractText = (txt, username, attachments) => {
            const regex = new RegExp(`^${username}`, 'ig');
            let text = txt.replace(regex, '');
            if (!R.isEmpty(attachments)) {
                R.forEach((attachment) => {
                    text = text.replace(`${attachment._url}`, '');
                }, attachments);
            }
            text = text.replace(/\s\s+/g, ' ');
            return R.trim(text);
        };
        const extractBestVideoURL = (variants) => {
            const eligible = R.filter((variant) => !R.isNil(variant.bitrate), variants);
            if (R.isEmpty(eligible)) {
                return null;
            }
            const bitrateLimit = 832001;
            const selected = R.reduce((prev, curr) => {
                if (prev) {
                    if (prev.bitrate > bitrateLimit
                        && curr.bitrate < prev.bitrate) {
                        return curr;
                    }
                    if (curr.bitrate > prev.bitrate
                        && curr.bitrate < bitrateLimit) {
                        return curr;
                    }
                    return prev;
                }
                return curr;
            }, null, eligible);
            return selected.url;
        };
        const authorInformation = event.user || event.sender;
        const dateCreatedAt = new Date(event.created_at);
        const attachments = R.reject(R.isNil)(R.map((media) => {
            if (media.type === 'photo') {
                return { type: 'Image', url: media.media_url_https, _url: media.url };
            }
            else if (media.type === 'video' || media.type === 'animated_gif') {
                const url = extractBestVideoURL(R.path(['video_info', 'variants'], media));
                if (!url) {
                    return null;
                }
                return { type: 'Video', url, _url: media.url };
            }
            return null;
        }, R.path(['entities', 'media'], event) || []));
        const data = {
            attachments,
            author: {
                id: authorInformation.id_str,
                name: authorInformation.name,
                profile_image_url: authorInformation.profile_image_url_https,
                username: authorInformation.screen_name,
            },
            channel: utils_1.cleanNulls({
                id: R.path(['recipient', 'id_str'], event),
                is_mention: R.path(['recipient', 'is_mention'], event),
                name: R.path(['recipient', 'name'], event),
                profile_image_url: R.path(['recipient', 'profile_image_url_https'], event),
                username: R.path(['recipient', 'screen_name'], event),
            }),
            hashtags: R.map((hashtag) => ({ text: hashtag.text }), R.path(['entities', 'hashtags'], event) || []),
            id: event.id_str,
            text: extractText(event.text, event._username, attachments),
            timestamp: dateCreatedAt.getTime(),
        };
        return Promise.resolve(data);
    }
    createIdentifier() {
        return uuid.v4();
    }
    createActivityStream(normalized) {
        return {
            '@context': 'https://www.w3.org/ns/activitystreams',
            'actor': {},
            'generator': {
                id: this.serviceID,
                name: this.generatorName,
                type: 'Service',
            },
            'published': normalized.timestamp ?
                Math.floor(normalized.timestamp / 1000)
                : Math.floor(Date.now() / 1000),
            'target': {},
            'type': 'Create',
        };
    }
}
exports.Parser = Parser;
