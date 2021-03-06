import Const from '../const';
import * as urlUtils from '../utils/url';
import * as contentUtils from '../utils/content';

//TODO rewrite parseProxyUrl instead
function flattenParsedProxyUrl (parsed) {
    if (parsed) {
        return {
            dest: {
                url:           parsed.originUrl,
                protocol:      parsed.originResourceInfo.protocol,
                host:          parsed.originResourceInfo.host,
                hostname:      parsed.originResourceInfo.hostname,
                port:          parsed.originResourceInfo.port,
                partAfterHost: parsed.originResourceInfo.partAfterHost,
                resourceType:  parsed.resourceType
            },
            jobInfo: parsed.jobInfo
        };
    }
}

function getContentTypeUrlToken (isScript, isIFrame) {
    if (isScript) return urlUtils.SCRIPT;
    if (isIFrame) return urlUtils.IFRAME;
    return null;
}


export default class PipelineContext {
    constructor (req, res, serverInfo) {
        this.serverInfo = serverInfo;
        this.session    = null;

        this.req     = req;
        this.reqBody = null;
        this.res     = res;

        this.dest          = null;
        this.destRes       = null;
        this.destResBody   = null;
        this.hasDestReqErr = false;

        this.isXhr       = false;
        this.isPage      = false;
        this.isIFrame    = false;
        this.contentInfo = null;

        var acceptHeader = req.headers['accept'];

        this.isXhr  = !!req.headers[Const.XHR_REQUEST_MARKER_HEADER];
        this.isPage = !this.isXhr && acceptHeader && contentUtils.isPage(acceptHeader);
    }

    _getDestFromReferer (parsedReferer) {
        // NOTE: browsers may send default port in referer.
        // But, since we compose destination URL from it we
        // need to skip port number if it's protocol default
        // port. Some servers has host conditions which do not
        // include port number.

        var rDest         = parsedReferer.dest;
        var isDefaultPort = rDest.protocol === 'https:' && rDest.port === '443' ||
                            rDest.protocol === 'http:' && rDest.port === '80';

        var dest = {
            protocol:      rDest.protocol,
            host:          isDefaultPort ? rDest.host.split(':')[0] : rDest.host,
            hostname:      rDest.hostname,
            port:          isDefaultPort ? '' : rDest.port,
            partAfterHost: this.req.url
        };

        dest.url = urlUtils.formatUrl(dest);

        return {
            dest:    dest,
            jobInfo: parsedReferer.jobInfo
        };
    }

    _isFileDownload () {
        var contentDisposition = this.destRes.headers['content-disposition'];

        return contentDisposition &&
               contentDisposition.indexOf('attachment') > -1 &&
               contentDisposition.indexOf('filename') > -1;
    }

    _getInjectable (injectable) {
        return injectable.map((url) => this.serverInfo.domain + url);
    }

    _initRequestNatureInfo () {
        var acceptHeader = this.req.headers['accept'];

        this.isXhr    = !!this.req.headers[Const.XHR_REQUEST_MARKER_HEADER];
        this.isPage   = !this.isXhr && acceptHeader && contentUtils.isPage(acceptHeader);
        this.isIFrame = this.dest.resourceType === urlUtils.IFRAME;
    }

    // API
    dispatch (openSessions) {
        var parsedReqUrl  = urlUtils.parseProxyUrl(this.req.url);
        var referer       = this.req.headers['referer'];
        var parsedReferer = referer && urlUtils.parseProxyUrl(referer);

        //TODO remove it after parseProxyURL rewrite
        parsedReqUrl  = flattenParsedProxyUrl(parsedReqUrl);
        parsedReferer = flattenParsedProxyUrl(parsedReferer);

        // NOTE: try to extract destination from the referer
        if (!parsedReqUrl && parsedReferer)
            parsedReqUrl = this._getDestFromReferer(parsedReferer);

        if (parsedReqUrl) {
            this.session = openSessions[parsedReqUrl.jobInfo.uid];

            if (!this.session)
                return false;

            this.dest        = parsedReqUrl.dest;
            this.dest.domain = urlUtils.getDomain(this.dest);

            if (parsedReferer) {
                this.dest.referer   = parsedReferer.dest.url;
                this.dest.reqOrigin = urlUtils.getDomain(parsedReferer.dest);
            }

            this._initRequestNatureInfo();

            return true;
        }

        return false;
    }

    buildContentInfo () {
        var contentType = this.destRes.headers['content-type'] || '';
        var accept      = this.req.headers['accept'] || '';

        var isCSS      = contentUtils.isCSSResource(contentType, accept);
        var isManifest = contentUtils.isManifest(contentType);
        var isJSON     = contentUtils.isJSON(contentType);
        var isScript   = this.dest.resourceType === urlUtils.SCRIPT ||
                         contentUtils.isScriptResource(contentType, accept);

        var requireProcessing = !this.isXhr &&
                                (this.isPage || this.isIFrame || isCSS || isScript || isManifest || isJSON);

        var isIFrameWithImageSrc = this.isIFrame && !this.isPage && /^\s*image\//.test(contentType);

        if (this._isFileDownload())
            this.session.handleFileDownload();

        this.contentInfo = {
            encoding:             this.destRes.headers['content-encoding'],
            charset:              contentUtils.parseCharset(contentType),
            requireProcessing:    requireProcessing,
            isIFrameWithImageSrc: isIFrameWithImageSrc,
            isCSS:                isCSS,
            isScript:             isScript,
            isManifest:           isManifest,
            isJSON:               isJSON,
            contentTypeUrlToken:  getContentTypeUrlToken(isScript, this.isIFrame)
        };
    }

    getInjectableScripts () {
        var taskScript = this.isIFrame ? '/iframe-task.js' : '/task.js';
        var scripts    = this.session.injectable.scripts.concat(taskScript);

        return this._getInjectable(scripts);
    }

    getInjectableStyles () {
        return this._getInjectable(this.session.injectable.styles);
    }

    redirect (url) {
        this.res.statusCode = 302;
        this.res.setHeader('location', url);
        this.res.end();
    }

    closeWithError (statusCode, resBody) {
        this.res.statusCode = statusCode;

        /*eslint-disable indent*/
        if (resBody) {
            this.res.setHeader('content-type', 'text/html');
            this.res.end(resBody);
        }
        else
            this.res.end();
        /*eslint-enable indent*/
    }

    toProxyUrl (url, isCrossDomain, resourceType) {
        var port = isCrossDomain ? this.serverInfo.crossDomainPort : this.serverInfo.port;

        return urlUtils.getProxyUrl(url, this.serverInfo.hostname, port, this.session.id, '', resourceType);
    }
}
