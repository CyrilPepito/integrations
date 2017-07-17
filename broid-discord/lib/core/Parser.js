"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const schemas_1 = require("@broid/schemas");
const utils_1 = require("@broid/utils");
const Promise = require("bluebird");
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
        this.logger.debug('Normalized process');
        const normalized = utils_1.cleanNulls(event);
        if (!normalized || R.isEmpty(normalized)) {
            return Promise.resolve(null);
        }
        const activitystreams = this.createActivityStream(normalized);
        activitystreams.actor = {
            id: R.path(['author', 'id'], normalized),
            name: R.path(['author', 'username'], normalized),
            type: R.path(['author', 'bot'], normalized) ? 'Application' : 'Person',
        };
        let targetType = 'Group';
        if (R.path(['channel', 'isPrivate'], normalized)) {
            targetType = 'Person';
        }
        let targetName = R.path(['channel', 'name'], normalized);
        if (R.isEmpty(targetName)) {
            targetName = R.path(['channel', 'id'], normalized);
        }
        activitystreams.target = {
            id: R.path(['channel', 'id'], normalized),
            name: targetName,
            type: targetType,
        };
        return Promise.map(normalized.attachments, (rawAttachment) => this.parseMedia(rawAttachment, null))
            .then(R.reject(R.isNil))
            .then((attachments) => {
            const count = R.length(attachments);
            if (count === 1) {
                activitystreams.object = R.assoc('content', normalized.content, attachments[0]);
            }
            else if (count > 1) {
                activitystreams.object = {
                    attachment: attachments,
                    content: normalized.content,
                    id: normalized.id,
                    type: 'Note',
                };
            }
            return activitystreams;
        })
            .then((as2) => {
            if (!as2.object && !R.isEmpty(normalized.content)) {
                as2.object = {
                    content: normalized.content,
                    id: normalized.id,
                    type: 'Note',
                };
            }
            return as2;
        });
    }
    parseMedia(media, content) {
        return utils_1.fileInfo(media.url, this.logger)
            .then((infos) => {
            const mimeType = infos.mimetype;
            let mediaType = null;
            if (mimeType.startsWith('image')) {
                mediaType = 'Image';
            }
            if (mimeType.startsWith('video')) {
                mediaType = 'Video';
            }
            if (mediaType && content) {
                return {
                    content,
                    id: media.id,
                    mediaType: mimeType,
                    name: media.filename,
                    type: mediaType,
                    url: media.url,
                };
            }
            else if (mediaType) {
                return {
                    id: media.id,
                    mediaType: mimeType,
                    name: media.filename,
                    type: mediaType,
                    url: media.url,
                };
            }
            return null;
        });
    }
    createActivityStream(normalized) {
        return {
            '@context': 'https://www.w3.org/ns/activitystreams',
            'generator': {
                id: this.serviceID,
                name: this.generatorName,
                type: 'Service',
            },
            'published': normalized.timestamp ?
                Math.floor(new Date(normalized.timestamp).getTime() / 1000)
                : Math.floor(Date.now() / 1000),
            'type': 'Create',
        };
    }
}
exports.Parser = Parser;
