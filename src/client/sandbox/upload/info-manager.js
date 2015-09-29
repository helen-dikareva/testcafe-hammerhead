/*global atob, Blob, FileReader*/
import COMMAND from '../../../command';
import FileListWrapper from './file-list-wrapper';
import nativeMethods from '../native-methods';
import transport from '../../transport';
import settings from '../../settings';
import * as Browser from '../../utils/browser';
import * as HiddenInfo from './hidden-info';
import { SHADOW_UI_CLASSNAME_POSTFIX } from '../../../const';

// NOTE: https://html.spec.whatwg.org/multipage/forms.html#fakepath-srsly
const FAKE_PATH_STRING = 'C:\\fakepath\\';

const UPLOAD_IFRAME_FOR_IE9_ID = 'uploadIFrameForIE9' + SHADOW_UI_CLASSNAME_POSTFIX;

export default class UploadInfoManager {
    constructor () {
        this.uploadInfo = [];
    }

    _getFileListData (fileList) {
        var data = [];

        for (var i = 0; i < fileList.length; i++)
            data.push(fileList[i].base64);

        return data;
    }

    _getUploadIFrameForIE9 () {
        var uploadIFrame = nativeMethods.querySelector.call(document, '#' + UPLOAD_IFRAME_FOR_IE9_ID);

        if (!uploadIFrame) {
            uploadIFrame               = nativeMethods.createElement.call(document, 'iframe');

            nativeMethods.setAttribute.call(uploadIFrame, 'id', UPLOAD_IFRAME_FOR_IE9_ID);
            nativeMethods.setAttribute.call(uploadIFrame, 'name', UPLOAD_IFRAME_FOR_IE9_ID);
            uploadIFrame.style.display = 'none';

            nativeMethods.querySelector.call(document, '#root' + SHADOW_UI_CLASSNAME_POSTFIX).appendChild(uploadIFrame);
        }

        return uploadIFrame;
    }

    _loadFileListDataForIE9 (input, callback) {
        var form = input.form;

        if (form && input.value) {
            var sourceTarget       = form.target;
            var sourceActionString = form.action;
            var sourceMethod       = form.method;
            var uploadIFrame       = this._getUploadIFrameForIE9();

            var loadHandler = () => {
                var fileListWrapper = new FileListWrapper([JSON.parse(uploadIFrame.contentWindow.document.body.innerHTML)]);

                uploadIFrame.removeEventListener('load', loadHandler);
                callback(fileListWrapper);
            };

            uploadIFrame.addEventListener('load', loadHandler);

            form.action = settings.get().ie9FileReaderShimUrl + '?input-name=' + input.name + '&filename=' +
                          input.value;
            form.target = UPLOAD_IFRAME_FOR_IE9_ID;
            form.method = 'post';

            form.submit();

            form.action = sourceActionString;
            form.target = sourceTarget;
            form.method = sourceMethod;
        }
        else
            callback(new FileListWrapper([]));
    }

    clearUploadInfo (input) {
        var inputInfo = this.getUploadInfo(input);

        if (inputInfo) {
            inputInfo.files = new FileListWrapper([]);
            inputInfo.value = '';

            return HiddenInfo.removeInputInfo(input);
        }
    }

    formatValue (fileNames) {
        var value = '';

        fileNames = typeof fileNames === 'string' ? [fileNames] : fileNames;

        if (fileNames && fileNames.length) {
            if (Browser.isWebKit)
                value = FAKE_PATH_STRING + fileNames[0].split('/').pop();
            else if (Browser.isIE9 || Browser.isIE10) {
                var filePaths = [];

                for (var i = 0; i < fileNames.length; i++)
                    filePaths.push(FAKE_PATH_STRING + fileNames[i].split('/').pop());

                value = filePaths.join(', ');
            }
            else
                return fileNames[0].split('/').pop();
        }

        return value;
    }

    getFileNames (fileList, value) {
        var result = [];

        if (fileList) {
            for (var i = 0; i < fileList.length; i++)
                result.push(fileList[i].name);
        }
        else if (value.lastIndexOf('\\') !== -1)
            result.push(value.substr(value.lastIndexOf('\\') + 1));

        return result;
    }

    getFiles (input) {
        var inputInfo = this.getUploadInfo(input);

        return inputInfo ? inputInfo.files : new FileListWrapper([]);
    }

    getUploadInfo (input) {
        for (var i = 0; i < this.uploadInfo.length; i++) {
            if (this.uploadInfo[i].input === input)
                return this.uploadInfo[i];
        }

        return null;
    }

    getValue (input) {
        var inputInfo = this.getUploadInfo(input);

        return inputInfo ? inputInfo.value : '';
    }

    loadFileListData (input, fileList, callback) {
        if (Browser.isIE9)
            this._loadFileListDataForIE9(input, callback);
        else if (!fileList.length)
            callback(new FileListWrapper([]));
        else {
            var index       = 0;
            var fileReader  = new FileReader();
            var file        = fileList[index];
            var readedFiles = [];

            fileReader.addEventListener('load', e => {
                readedFiles.push({
                    data: e.target.result.substr(e.target.result.indexOf(',') + 1),
                    blob: file.slice(0, file.size),
                    info: {
                        type:             file.type,
                        name:             file.name,
                        lastModifiedDate: file.lastModifiedDate
                    }
                });

                if (fileList[++index]) {
                    file = fileList[index];
                    fileReader.readAsDataURL(file);
                }
                else
                    callback(new FileListWrapper(readedFiles));
            });
            fileReader.readAsDataURL(file);
        }
    }

    loadFilesInfoFromServer (filePaths, callback) {
        transport.asyncServiceMsg({
            cmd:       COMMAND.getUploadedFiles,
            filePaths: typeof filePaths === 'string' ? [filePaths] : filePaths
        }, callback);
    }

    prepareFileListWrapper (filesInfo, callback) {
        var errs           = [];
        var validFilesInfo = [];

        for (var i = 0; i < filesInfo.length; i++) {
            if (filesInfo[i].err)
                errs.push(filesInfo[i]);
            else
                validFilesInfo.push(filesInfo[i]);
        }

        callback(errs, new FileListWrapper(validFilesInfo));
    }

    setUploadInfo (input, fileList, value) {
        var inputInfo = this.getUploadInfo(input);

        if (!inputInfo) {
            inputInfo = { input: input };
            this.uploadInfo.push(inputInfo);
        }

        inputInfo.files = fileList;
        inputInfo.value = value;

        HiddenInfo.addInputInfo(input, fileList, value);
    }

    sendFilesInfoToServer (fileList, fileNames, callback) {
        transport.asyncServiceMsg({
            cmd:       COMMAND.uploadFiles,
            data:      this._getFileListData(fileList),
            fileNames: fileNames
        }, callback);
    }
}