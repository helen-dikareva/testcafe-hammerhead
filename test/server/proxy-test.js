var fs                 = require('fs');
var request            = require('request');
var expect             = require('chai').expect;
var express            = require('express');
var Promise            = require('es6-promise').Promise;
var Proxy              = require('../../lib/proxy');
var Session            = require('../../lib/session');
var DestinationRequest = require('../../lib/pipeline/destination-request');
var requestAgent       = require('../../lib/pipeline/request-agent');
var ERR                = require('../../lib/errs');
var SERVICE_CMD        = require('../../lib/service-msg-cmd');
var SHARED_CONST       = require('../../lib/const');

function normalizeCode (code) {
    return code
        .replace(/(\r\n|\n|\r)/gm, ' ')
        .replace(/'/gm, '"')
        .replace(/\s+/gm, ' ');
}

function compareCode (code1, code2) {
    expect(normalizeCode(code1)).eql(normalizeCode(code2));
}


describe('Proxy', function () {
    var destServer = null;
    var proxy      = null;
    var session    = null;

    // Fixture setup/teardown
    before(function () {
        var app = express();

        app.post('/', function (req, res) {
            var data = '';

            req.on('data', function (chunk) {
                data += chunk.toString();
            });

            req.on('end', function () {
                res.end(data);
            });
        });

        app.get('/cookie/set-and-redirect', function (req, res) {
            res.statusCode = 302;

            res.set('set-cookie', 'Test=value; Path=/cookie');
            res.set('location', '/cookie/echo');

            res.end();
        });

        app.get('/cookie/echo', function (req, res) {
            res.end(req.headers['cookie']);
        });

        app.get('/page', function (req, res) {
            res.set('content-type', 'text/html; charset=utf-8');
            res.end(fs.readFileSync('test/server/data/page/src.html').toString());
        });

        app.get('/script', function (req, res) {
            res.set('content-type', 'application/javascript; charset=utf-8');
            res.end(fs.readFileSync('test/server/data/script/src.js').toString());
        });

        app.get('/stylesheet', function (req, res) {
            res.end(fs.readFileSync('test/server/data/stylesheet/src.css').toString());
        });

        app.get('/manifest', function (req, res) {
            res.set('content-type', 'text/cache-manifest');
            res.end(fs.readFileSync('test/server/data/manifest/src.manifest')).toString();
        });

        app.get('/xhr-origin/allow-any', function (req, res) {
            res.set('access-control-allow-origin', '*');
            res.end('42');
        });

        app.get('/xhr-origin/allow-provided', function (req, res) {
            res.set('access-control-allow-origin', req.headers['x-allow-origin']);
            res.end('42');
        });

        app.get('/page/plain-text', function (req, res) {
            res.set('content-encoding', 'gzip');
            res.set('content-type', 'text/html; charset=utf-8');
            res.end('42');
        });

        app.options('/preflight', function (req, res) {
            res.end('42');
        });

        app.get('/with-auth', function (req, res) {
            var authHeader = req.headers['authorization'];

            if (authHeader) {
                var expectedAuthCredentials = 'testUsername:testPassword';
                var expectedAuthHeader      = 'Basic ' + new Buffer(expectedAuthCredentials).toString('base64');

                if (authHeader === expectedAuthHeader) {
                    res.end('42');
                    return;
                }
            }

            res.status(401);
            res.set('www-authenticate', 'Basic');
            res.end();
        });

        app.get('/B234325/reply-with-origin', function (req, res) {
            res.set('access-control-allow-origin', 'http://example.com');
            res.end(req.headers['origin']);
        });

        app.get('/Q557255/page-without-content-type', function (req, res) {
            res.set('content-encoding', 'gzip');
            res.end('42');
        });

        app.get('/T232505/is-cookie-header-sent', function (req, res) {
            var headerSent = req.headers['cookie'] !== void 0;

            res.end(headerSent.toString());
        });

        app.get('/T224541/hang-forever', function () {
            // Just hang forever...
        });

        app.get('/B239430/empty-page', function (req, res) {
            res.set('content-type', 'text/html; charset=utf-8');
            res.end();
        });

        app.get('/T239167/send-location', function (req, res) {
            res.writeHead(200, { 'location': 'http://127.0.0.1:2000/\u0410\u0411' });
            res._send('');
            res.end();
        });

        destServer = app.listen(2000);
    });

    after(function () {
        destServer.close();
    });


    // Test setup/teardown
    beforeEach(function () {
        session = new Session();

        session.getAuthCredentials = function () {
            return null;
        };

        proxy = new Proxy('127.0.0.1', 1836, 1837);
    });

    afterEach(function () {
        proxy.close();
        requestAgent.resetKeepAliveConnections();
    });


    // Tests
    describe('Session', function () {
        it('Should pass DNS errors to session', function (done) {
            session.handlePageError = function (ctx, err) {
                expect(err.code).eql(ERR.PROXY_CANT_RESOLVE_ORIGIN_URL);
                ctx.res.end();
                done();
                return true;
            };

            var options = {
                url:     proxy.openSession('http://www.some-unresolvable.url', session),
                headers: {
                    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*!/!*;q=0.8'
                }
            };

            request(options);
        });

        it('Should pass service message processing to session', function (done) {
            var options = {
                method: 'POST',
                url:    'http://localhost:1836/messaging',
                body:   JSON.stringify({
                    cmd:    'ServiceTestCmd',
                    data:   '42',
                    jobUid: session.id
                })
            };

            proxy.openSession('http://example.com', session);

            session['ServiceTestCmd'] = function (msg, serverInfo) {
                expect(serverInfo).to.be.an('object');
                return 'answer: ' + msg.data;
            };

            request(options, function (err, res, body) {
                expect(JSON.parse(body)).eql('answer: 42');
                done();
            });
        });

        it('Should render task script', function (done) {
            function testTaskScriptRequest (url, scriptBody) {
                return new Promise(function (resolve) {
                    var options = {
                        url:     url,
                        headers: {
                            referer: proxy.openSession('http://example.com', session)
                        }
                    };

                    request(options, function (err, res, body) {
                        expect(body).contains(scriptBody);
                        expect(res.headers['content-type']).eql('application/x-javascript');
                        expect(res.headers['cache-control']).eql('no-cache, no-store, must-revalidate');
                        expect(res.headers['pragma']).eql('no-cache');
                        resolve();
                    });
                });
            }

            session._getPayloadScript = function () {
                return 'PayloadScript';
            };

            session._getIFramePayloadScript = function () {
                return 'IFramePayloadScript';
            };

            Promise
                .all([
                    testTaskScriptRequest('http://localhost:1836/task.js', 'PayloadScript'),
                    testTaskScriptRequest('http://localhost:1836/iframe-task.js', 'IFramePayloadScript')
                ])
                .then(function () {
                    done();
                })
                .catch(done);
        });

        it('Should convert origin host and protocol to lower case', function () {
            // BUG: https://github.com/superroma/testcafe-hammerhead/issues/1
            var proxiedUrl = proxy.openSession('hTtp://ExaMple.Com:123/paTh/Image?Name=Value&#Hash', session);

            expect(proxiedUrl).to.have.string('http://example.com:123/paTh/Image?Name=Value&#Hash');
        });
    });


    describe('Cookies', function () {
        it('Should process SET_COOKIE service message', function (done) {
            var options = {
                method: 'POST',
                url:    'http://localhost:1836/messaging',
                body:   JSON.stringify({
                    cmd:    SERVICE_CMD.SET_COOKIE,
                    url:    proxy.openSession('http://example.com', session),
                    cookie: 'Test=Data',
                    jobUid: session.id
                })
            };

            request(options, function (err, res, body) {
                expect(JSON.parse(body)).eql('Test=Data');
                done();
            });
        });

        it('Should handle "Cookie" and "Set-Cookie" headers', function (done) {
            var options = {
                url:            proxy.openSession('http://127.0.0.1:2000/cookie/set-and-redirect', session),
                followRedirect: true
            };

            request(options, function (err, res, body) {
                expect(body).eql('Test=value');
                done();
            });
        });
    });

    describe('XHR same-origin policy', function () {
        it('Should restrict requests from other domain', function (done) {
            var options = {
                url:     proxy.openSession('http://127.0.0.1:2000/page/plain-text', session),
                headers: {
                    referer: proxy.openSession('http://example.com', session)
                }
            };

            options.headers[SHARED_CONST.XHR_REQUEST_MARKER_HEADER] = 0x00.toString();

            request(options, function (err, res, body) {
                expect(res.statusCode).eql(0);
                expect(body).to.be.empty;
                done();
            });
        });

        it('Should restrict preflight requests from other domain', function (done) {
            var options = {
                method:  'OPTIONS',
                url:     proxy.openSession('http://127.0.0.1:2000/preflight', session),
                headers: {
                    referer: proxy.openSession('http://example.com', session)
                }
            };

            options.headers[SHARED_CONST.XHR_REQUEST_MARKER_HEADER] = 0x00.toString();

            request(options, function (err, res, body) {
                expect(res.statusCode).eql(0);
                expect(body).to.be.empty;
                done();
            });
        });

        it('Should allow preflight requests from other domain if CORS is enabled', function (done) {
            var options = {
                method:  'OPTIONS',
                url:     proxy.openSession('http://127.0.0.1:2000/preflight', session),
                headers: {
                    referer: proxy.openSession('http://example.com', session)
                }
            };

            options.headers[SHARED_CONST.XHR_REQUEST_MARKER_HEADER] = SHARED_CONST.XHR_CORS_SUPPORTED_FLAG;

            request(options, function (err, res, body) {
                expect(res.statusCode).eql(200);
                expect(body).eql('42');
                done();
            });
        });

        it('Should allow requests from other domain if CORS is enabled and allowed origin is wildcard ', function (done) {
            var options = {
                url:     proxy.openSession('http://127.0.0.1:2000/xhr-origin/allow-any', session),
                headers: {
                    referer: proxy.openSession('http://example.com', session)
                }
            };

            options.headers[SHARED_CONST.XHR_REQUEST_MARKER_HEADER] = SHARED_CONST.XHR_CORS_SUPPORTED_FLAG;

            request(options, function (err, res, body) {
                expect(res.statusCode).eql(200);
                expect(body).eql('42');
                done();
            });
        });

        it('Should allow requests from other domain if CORS is enabled and origin is allowed', function (done) {
            var options = {
                url:     proxy.openSession('http://127.0.0.1:2000/xhr-origin/allow-provided', session),
                headers: {
                    referer:          proxy.openSession('http://example.com', session),
                    'x-allow-origin': 'http://example.com'
                }
            };

            options.headers[SHARED_CONST.XHR_REQUEST_MARKER_HEADER] = SHARED_CONST.XHR_CORS_SUPPORTED_FLAG;

            request(options, function (err, res, body) {
                expect(res.statusCode).eql(200);
                expect(body).eql('42');
                done();
            });
        });
    });

    describe('Content processing', function () {
        it('Should process pages', function (done) {
            session.id = 1337;
            session.injectable.scripts.push('/script1.js');
            session.injectable.scripts.push('/script2.js');
            session.injectable.styles.push('/styles.css');

            var options = {
                url:     proxy.openSession('http://127.0.0.1:2000/page', session),
                headers: {
                    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*!/!*;q=0.8'
                }
            };

            request(options, function (err, res, body) {
                var expected = fs.readFileSync('test/server/data/page/expected.html').toString();

                compareCode(body, expected);
                done();
            });
        });

        it('Should not process XHR page requests', function (done) {
            var options = {
                url:     proxy.openSession('http://127.0.0.1:2000/page', session),
                headers: {
                    accept:  'text/html,application/xhtml+xml,application/xml;q=0.9,*!/!*;q=0.8',
                    referer: proxy.openSession('http://127.0.0.1:2000/', session)
                }
            };

            options.headers[SHARED_CONST.XHR_REQUEST_MARKER_HEADER] = 0x00.toString();

            request(options, function (err, res, body) {
                var expected = fs.readFileSync('test/server/data/page/src.html').toString();

                compareCode(body, expected);
                done();
            });
        });


        it('Should process scripts', function (done) {
            session.id = 1337;

            request(proxy.openSession('http://127.0.0.1:2000/script', session), function (err, res, body) {
                var expected = fs.readFileSync('test/server/data/script/expected.js').toString();

                compareCode(body, expected);
                done();
            });
        });

        it('Should process manifests', function (done) {
            session.id = 1337;

            request(proxy.openSession('http://127.0.0.1:2000/manifest', session), function (err, res, body) {
                var expected = fs.readFileSync('test/server/data/manifest/expected.manifest').toString();

                compareCode(body, expected);
                done();
            });
        });

        it('Should process stylesheets', function (done) {
            session.id = 1337;

            var options = {
                url:     proxy.openSession('http://127.0.0.1:2000/stylesheet', session),
                headers: {
                    accept: 'text/css'
                }
            };

            request(options, function (err, res, body) {
                var expected = fs.readFileSync('test/server/data/stylesheet/expected.css').toString();

                compareCode(body, expected);
                done();
            });
        });
    });

    describe('Basic authentication', function () {
        it('Should perform basic authentication', function (done) {
            session.getAuthCredentials = function () {
                return {
                    username: 'testUsername',
                    password: 'testPassword'
                };
            };

            request(proxy.openSession('http://127.0.0.1:2000/with-auth', session), function (err, res, body) {
                expect(res.statusCode).eql(200);
                expect(body).eql('42');
                done();
            });
        });

        it('Should return "401 - Unauthorized" for wrong credentials', function (done) {
            session.getAuthCredentials = function () {
                return {
                    username: 'wrongUsername',
                    password: 'wrongPassword'
                };
            };

            request(proxy.openSession('http://127.0.0.1:2000/with-auth', session), function (err, res, body) {
                expect(res.statusCode).eql(401);
                expect(body).to.be.empty;
                done();
            });
        });
    });

    describe('Regression', function () {
        it('Should force "Origin" header for the same-domain requests (B234325)', function (done) {
            var options = {
                url:     proxy.openSession('http://127.0.0.1:2000/B234325/reply-with-origin', session),
                headers: {
                    referer: proxy.openSession('http://example.com', session)
                }
            };

            options.headers[SHARED_CONST.XHR_REQUEST_MARKER_HEADER] = SHARED_CONST.XHR_CORS_SUPPORTED_FLAG;

            request(options, function (err, res, body) {
                expect(body).eql('http://example.com');
                done();
            });
        });

        it('Should not send "Cookie" header if there are no cookies for the given URL (T232505)', function (done) {
            var url = proxy.openSession('http://127.0.0.1:2000/T232505/is-cookie-header-sent', session);

            request(url, function (err, res, body) {
                expect(JSON.parse(body)).to.be.false;
                done();
            });
        });

        it('Should raise error on request timeout (T224541)', function (done) {
            var savedReqTimeout = DestinationRequest.TIMEOUT;

            DestinationRequest.TIMEOUT = 200;

            session.handlePageError = function (ctx, err) {
                expect(err.code).eql(ERR.PROXY_ORIGIN_SERVER_REQUEST_TIMEOUT);
                expect(err.destUrl).eql('http://127.0.0.1:2000/T224541/hang-forever');
                ctx.res.end();
                DestinationRequest.TIMEOUT = savedReqTimeout;
                done();
                return true;
            };

            var options = {
                url:     proxy.openSession('http://127.0.0.1:2000/T224541/hang-forever', session),
                headers: {
                    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*!/!*;q=0.8'
                }
            };

            request(options);
        });

        // NOTE: requires fix in node.js
        it.skip('Should not encode cyrillic symbols in header (T239167, GH-nodejs/io.js#1693)', function (done) {
            var url              = proxy.openSession('http://127.0.0.1:2000/T239167/send-location', session);
            var expectedLocation = proxy.openSession('http://127.0.0.1:2000/\u0410\u0411', session);

            request(url, function (err, res) {
                expect(res.headers['location']).eql(expectedLocation);
                done();
            });
        });

        it('Should process empty pages (B239430)', function (done) {
            var options = {
                url:     proxy.openSession('http://127.0.0.1:2000/B239430/empty-page', session),
                headers: {
                    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*!/!*;q=0.8'
                }
            };

            request(options, function (err, res, body) {
                var expected = fs.readFileSync('test/server/data/empty-page/expected.html').toString();

                compareCode(body, expected);
                done();
            });
        });
    });
});
