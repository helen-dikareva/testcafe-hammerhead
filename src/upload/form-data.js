import FormDataEntry from './form-data-entry';
import * as bufferUtils from '../utils/buffer';
import Const from '../const';

// Const
const BOUNDARY_RE = /;\s*boundary=([^;]*)/i;

const PARSER_STATE = {
    IN_PREAMBLE: 'IN_PREAMBLE',
    IN_HEADERS:  'IN_HEADERS',
    IN_BODY:     'IN_BODY',
    IN_EPILOGUE: 'IN_EPILOGUE'
};


// Form data
export default class FormData {
    constructor () {
        this.boundary    = null;
        this.boundaryEnd = null;
        this.epilogue    = [];
        this.entries     = [];
        this.preamble    = [];
    }

    _removeEntry (name) {
        this.entries = this.entries.filter((entry) => entry.name !== name);
    }

    _injectFileInfo (fileInfo) {
        var entries = this.getEntriesByName(fileInfo.name);

        while (entries.length < fileInfo.files.length) {
            var newEntry = new FormDataEntry();

            this.entries.push(newEntry);
            entries.push(newEntry);
        }

        entries.forEach((entry, idx) => entry.addFileInfo(fileInfo, idx));
    }

    _isBoundary (line) {
        return bufferUtils.equals(this.boundary, line);
    }

    _isBoundaryEnd (line) {
        return bufferUtils.equals(this.boundaryEnd, line);
    }

    getEntriesByName (name) {
        return this.entries.reduce((found, entry) => {
            if (entry.name === name)
                found.push(entry);

            return found;
        }, []);
    }

    expandUploads () {
        var uploadsEntry = this.getEntriesByName(Const.UPLOAD_SANDBOX_HIDDEN_INPUT_NAME)[0];

        if (uploadsEntry) {
            var body  = Buffer.concat(uploadsEntry.body).toString();
            var files = JSON.parse(body);

            this._removeEntry(Const.UPLOAD_SANDBOX_HIDDEN_INPUT_NAME);
            files.forEach((fileInfo) => this._injectFileInfo(fileInfo));
        }
    }

    parseContentTypeHeader (header) {
        header = String(header);

        if (header.indexOf('multipart/form-data') > -1) {
            var boundaryMatch = header.match(BOUNDARY_RE);
            var token         = boundaryMatch && boundaryMatch[1];

            if (token) {
                this.boundary    = new Buffer('--' + token);
                this.boundaryEnd = new Buffer('--' + token + '--');
            }
        }
    }

    parseBody (body) {
        var state        = PARSER_STATE.IN_PREAMBLE;
        var lines        = bufferUtils.createLineIterator(body);
        var currentEntry = null;

        for (var line of lines) {
            /*eslint-disable indent*/
            if (this._isBoundary(line)) {
                if (currentEntry)
                    this.entries.push(currentEntry);

                state        = PARSER_STATE.IN_HEADERS;
                currentEntry = new FormDataEntry();
            }

            else if (this._isBoundaryEnd(line)) {
                if (currentEntry)
                    this.entries.push(currentEntry);

                state = PARSER_STATE.IN_EPILOGUE;
            }

            else if (state === PARSER_STATE.IN_PREAMBLE)
                bufferUtils.appendLine(this.preamble, line);

            else if (state === PARSER_STATE.IN_HEADERS) {
                if (line.length)
                    currentEntry.setHeader(line.toString());

                else
                    state = PARSER_STATE.IN_BODY;
            }

            else if (state === PARSER_STATE.IN_EPILOGUE)
                bufferUtils.appendLine(this.epilogue, line);

            else if (state === PARSER_STATE.IN_BODY)
                bufferUtils.appendLine(currentEntry.body, line);
            /*eslint-enable indent*/
        }
    }

    toBuffer () {
        var chunks = this.preamble;

        if (chunks.length)
            chunks.push(bufferUtils.CRLF);

        this.entries.forEach((entry) => {
            chunks.push(
                this.boundary,
                bufferUtils.CRLF,
                entry.toBuffer(),
                bufferUtils.CRLF
            );
        });

        chunks.push(
            this.boundaryEnd,
            bufferUtils.CRLF
        );

        chunks = chunks.concat(this.epilogue);

        return Buffer.concat(chunks);
    }
}
