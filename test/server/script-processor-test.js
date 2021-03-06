var expect      = require('chai').expect;
var multiline   = require('multiline');
var jsProcessor = require('../../lib/processing/js');

var ACORN_PROPERTY_NODES_PATCH_WARNING = multiline(function () {/*
 ATTENTION! If this test fails seems like you have updated acorn.
 We have patched acorn to make it work "Property" nodes.

 HOW TO FIX - go to acorn an replace this code:
 ```
 var prop = {key: parsePropertyName()}, isGetSet = false, kind;
 ```

 with this code:

 ```
 var prop = {type: "Property", key: parsePropertyName()}, isGetSet = false, kind;
 ```
 */
});

var ACORN_UNICODE_PATCH_WARNING = multiline(function () {/*
 ATTENTION! If this test fails seems like you have updated acorn.
 We have patched acorn to make it work with the unicode identifiers.

 HOW TO FIX - go to acorn an replace this code:
 ```
 function readWord1() {
    ...
    word += escStr;
    ...
 }
 ```

 with this code:

 ```
 function readWord1() {
    ...
    word += input.substr(tokPos-6, 6);;
    ...
 }
 ```
*/
});

var ACORN_STRICT_MODE_PATCH_WARNING = multiline(function () {/*
 ATTENTION! If this test fails seems like you have updated acorn.
 We have patched acorn to make it with ES6 syntax in strict mode.

 HOW TO FIX - go to acorn an replace this code:
 ```
 function isUseStrict(stmt) {
     return this.options.ecmaVersion >= 5 && stmt.type === "ExpressionStatement" &&
         stmt.expression.type === "Literal" && stmt.expression.value === "use strict";
 }
 ```

 with this code:

 ```
 function isUseStrict(stmt) {
    return false;
 }
 ```
*/
});

var ESOTOPE_RAW_LITERAL_PATCH_WARNING = multiline(function () {/*
 ATTENTION! If this test fails seems like you have updated esotope.
 We have patched esotope to make it work with raw literals without
 additional parsing.

 HOW TO FIX - go to esotope an replace this code:
 ```
 if (parse && extra.raw && canUseRawLiteral($expr))
    _.js += $expr.raw;
 ```

 with this code:

 ```
 if (extra.raw && $expr.raw !== void 0)
    _.js += $expr.raw;
 ```
 */
});

var ESOTOPE_T170848_PATCH_WARNING = multiline(function () {/*
 ATTENTION! If this test fails seems like you have updated esotope.
 We have patched esotope so it will insert empty comment in case
 of empty function body, which allows it to work in T170848 case.

 HOW TO FIX - go to esotope and add this code to the BlockStatement
 gen before stmt body items generation::
 ```
 if (settings.functionBody && !$body.length)
    _.js += "/**\/";'
 ```
 */
});


function normalizeCode (code) {
    return code
        .replace(/(\r\n|\n|\r)/gm, ' ')
        .replace(/'/gm, '"')
        .replace(/\s+/gm, '');
}

function testProcessing (testCases) {
    testCases = Array.isArray(testCases) ? testCases : [testCases];

    testCases.forEach(function (testCase) {
        var processed = jsProcessor.process(testCase.src);
        var actual    = normalizeCode(processed);
        var expected  = normalizeCode(testCase.expected);
        var msg       = 'Source: ' + testCase.src + '\n' +
                        'Result: ' + processed + '\n' +
                        'Expected: ' + testCase.expected + '\n';

        if (testCase.msg)
            msg += '\n\n' + testCase.msg;

        expect(actual).eql(expected, msg);
    });
}

function testPropertyProcessing (templates) {
    Object.keys(jsProcessor.wrappedProperties).forEach(function (propName) {
        var testCases = templates.map(function (template) {
            return {
                src:      template.src.replace(/\{0\}/g, propName),
                expected: template.expected.replace(/\{0\}/g, propName)
            };
        });

        testProcessing(testCases);
    });
}

describe('Script processor', function () {
    it('Should determine if script was processed', function () {
        var src       = '//comment\n var temp = 0; \n var host = location.host; \n temp = 1; \n // comment';
        var processed = jsProcessor.process(src);

        expect(jsProcessor.isScriptProcessed(src)).to.be.false;
        expect(jsProcessor.isScriptProcessed(processed)).to.be.true;
    });

    it('Should process location getters and setters', function () {
        testProcessing([
            { src: 'var location = value', expected: 'var location = value' },
            {
                src:      'location = value',
                expected: '(function() { return __set$Loc(location, value) || (location = value); }.apply(this))'
            },
            {
                src:      '{ location: 123 }',
                expected: '{ location: 123 }',
                msg:      ACORN_PROPERTY_NODES_PATCH_WARNING
            },
            { src: '[ location ]', expected: '[ __get$Loc(location) ]' },
            { src: 'var loc = location', expected: 'var loc = __get$Loc(location)' },
            { src: 'location ? true : false', expected: '__get$Loc(location) ? true : false' },
            { src: 'location + ""', expected: '__get$Loc(location) + ""' },
            { src: 'location.hostname', expected: '__get$(__get$Loc(location), "hostname")' },
            { src: 'location["hostname"]', expected: '__get$(__get$Loc(location), "hostname")' },
            { src: 'location[hostname]', expected: '__get$(__get$Loc(location), hostname)' },
            { src: 'location.href', expected: '__get$(__get$Loc(location), "href")' },
            { src: 'var func = function(location){}', expected: 'var func = function(location){}' },
            { src: 'function func(location){}', expected: 'function func(location){}' },
            { src: 'location[someProperty]', expected: '__get$(__get$Loc(location), someProperty)' },
            { src: 'location.host.toString()', expected: '__get$(__get$Loc(location), "host").toString()' },
            { src: 'location[host].toString()', expected: '__get$(__get$Loc(location), host).toString()' },
            {
                src:      'temp = { location: value, value: location }',
                expected: 'temp = { location: value, value: __get$Loc(location) }',
                msg:      ACORN_PROPERTY_NODES_PATCH_WARNING
            },

            { src: '--location', expected: '--location' },
            { src: 'location--', expected: 'location--' },
            { src: 'location++', expected: 'location++' },
            { src: '++location', expected: '++location' },

            {
                src:      'location+=value',
                expected: '(function(){return __set$Loc(location,__get$Loc(location)+value)||' +
                          '(location=__get$Loc(location)+value);}.apply(this))'
            },
            {
                src:      'location+=location+value',
                expected: '(function(){return __set$Loc(location,__get$Loc(location)+(__get$Loc(location)+value))||' +
                          '(location=__get$Loc(location)+(__get$Loc(location)+value));}.apply(this))'
            },
            {
                src:      'location.hostname+=value',
                expected: '__set$(__get$Loc(location), "hostname", __get$(__get$Loc(location), "hostname") + value)'
            },
            {
                src:      'location.href+=value',
                expected: '__set$(__get$Loc(location), "href", __get$(__get$Loc(location), "href") + value)'
            },
            {
                src:      'location[hostname]+=value',
                expected: '__set$(__get$Loc(location), hostname, __get$(__get$Loc(location), hostname) + value)'
            },
            {
                src:      'location["hostname"]+=value',
                expected: '__set$(__get$Loc(location), "hostname", __get$(__get$Loc(location), "hostname") + value)'
            },
            {
                src:      'location["href"]+=value',
                expected: '__set$(__get$Loc(location), "href", __get$(__get$Loc(location), "href") + value) '
            },

            {
                src: 'location-=value;location*=value;location/=value;' +
                     'location>>=value;location<<=value;location>>>=value;' +
                     'location&=value;location|=value;location^=value',

                expected: 'location-=value;location*=value;location/=value;' +
                          'location>>=value;location<<=value;location>>>=value;' +
                          'location&=value;location|=value;location^=value'
            }
        ]);
    });

    it('Should expand concat operator', function () {
        testProcessing([
            { src: 'prop += 1', expected: 'prop = prop + 1' },
            { src: 'prop += 2 + prop + 1', expected: 'prop = prop + (2 + prop + 1)' }
        ]);
    });

    it('Should process function body in Function ctor', function () {
        testProcessing([
            { src: 'new Function();', expected: 'new Function();' },
            { src: 'new Function(\'return a.href;\');', expected: 'new Function(__proc$Script(\'return a.href;\'));' },
            { src: 'new Function("x", "y", body);', expected: 'new Function("x", "y", __proc$Script(body));' }
        ]);
    });

    it('Should process properties', function () {
        testPropertyProcessing([
            { src: 'obj.{0}', expected: '__get$(obj, "{0}")' },
            { src: 'obj.{0} = value', expected: '__set$(obj, "{0}", value)' },
            { src: 'obj.{0}.subProp', expected: '__get$(obj, "{0}").subProp' },
            { src: 'obj.{0}.{0} = value', expected: '__set$(__get$(obj, "{0}"),"{0}", value)' },
            { src: 'delete obj.{0}', expected: 'delete obj.{0}' },
            { src: 'obj.{0}.method()', expected: '__get$(obj, "{0}").method()' },
            { src: 'new (obj.{0})()', expected: 'new (obj.{0})()' },

            { src: '--obj.{0}', expected: '--obj.{0}' },
            { src: 'obj.{0}--', expected: 'obj.{0}--' },
            { src: 'obj.{0}++', expected: 'obj.{0}++' },
            { src: '++obj.{0}', expected: '++obj.{0}' },
            { src: 'obj.{0}()', expected: 'obj.{0}()' },

            { src: 'obj.{0}+=value', expected: '__set$(obj, "{0}", __get$(obj, "{0}")+value)' },
            {
                src:      'obj.{0}+=obj.{0}+value',
                expected: '__set$(obj,"{0}",__get$(obj, "{0}")+(__get$(obj, "{0}")+value))'
            },
            { src: 'obj.{0}.field+=value', expected: '__get$(obj, "{0}").field = __get$(obj, "{0}").field + value' },
            {
                src:      'obj.{0}[field]+=value',
                expected: '__set$(__get$(obj,"{0}"),field,__get$(__get$(obj,"{0}"), field) + value)'
            },
            {
                src:      'obj.{0}["field"]+=value',
                expected: '__get$(obj,"{0}")["field"]=__get$(obj,"{0}")["field"] + value'
            },
            {
                src:      'obj.{0}["href"]+=value',
                expected: '__set$(__get$(obj,"{0}"),"href", __get$(__get$(obj,"{0}"), "href") + value)'
            },
            { src: 'result = $el[0].{0}', expected: 'result = __get$($el[0], "{0}")' },
            { src: 'obj.{0} = value, obj1 = value', expected: '__set$(obj,"{0}",value), obj1 = value' },

            {
                src: 'obj.{0}-=value;obj.{0}*=value;obj.{0}/=value;' +
                     'obj.{0}>>=value;obj.{0}<<=value;obj.{0}>>>=value;' +
                     'obj.{0}&=value;obj.{0}|=value;obj.{0}^=value',

                expected: 'obj.{0}-=value;obj.{0}*=value;obj.{0}/=value;' +
                          'obj.{0}>>=value;obj.{0}<<=value;obj.{0}>>>=value;' +
                          'obj.{0}&=value;obj.{0}|=value;obj.{0}^=value'
            }
        ]);
    });

    it('Should process computed properties', function () {
        testPropertyProcessing([
            { src: 'var temp = "location"; obj[t]', expected: 'var temp = "location";__get$(obj, t)' },
            {
                src:      'obj[prop1]["prop2"].{0}.{0} = value',
                expected: '__set$(__get$(__get$(obj, prop1)["prop2"], "{0}"),"{0}", value)'
            },
            { src: 'obj[someProperty] = value', expected: '__set$(obj, someProperty, value)' },
            { src: 'delete obj[{0}]', expected: 'delete obj[{0}]' },
            { src: 'new (obj["{0}"])()', expected: 'new (obj["{0}"])()' },

            { src: '--obj[{0}]', expected: '--obj[{0}]' },
            { src: 'obj[{0}]--', expected: 'obj[{0}]--' },
            { src: 'obj[0]++', expected: 'obj[0]++' },
            { src: '++obj[0]', expected: '++obj[0]' },
            { src: 'obj[someProperty](1,2,3)', expected: '__call$(obj,someProperty,[1,2,3])' },

            {
                src: 'obj[{0}]-=value;obj[{0}]*=value;obj[{0}]/=value;' +
                     'obj[{0}]>>=value;obj[{0}]<<=value;obj[{0}]>>>=value;' +
                     'obj[{0}]&=value;obj[{0}]|=value;obj[{0}]^=value',

                expected: 'obj[{0}]-=value;obj[{0}]*=value;obj[{0}]/=value;' +
                          'obj[{0}]>>=value;obj[{0}]<<=value;obj[{0}]>>>=value;' +
                          'obj[{0}]&=value;obj[{0}]|=value;obj[{0}]^=value'
            }
        ]);
    });

    it('Should process object expressions', function () {
        testProcessing({
            src:                     '{ location: value, value: location, src: src }',
            expected:                '{ location: value, value: __get$Loc(location), src: src }',
            additionalAssertionText: ACORN_PROPERTY_NODES_PATCH_WARNING
        });
    });

    it('Should keep raw literals', function () {
        testProcessing({
            src:      'obj["\\u003c/script>"]=location',
            expected: 'obj["\\u003c/script>"]=__get$Loc(location)',
            msg:      ESOTOPE_RAW_LITERAL_PATCH_WARNING
        });
    });

    it('Should process eval()', function () {
        testProcessing([
            { src: 'eval(script)', expected: 'eval(__proc$Script(script))' },
            { src: 'eval("script")', expected: 'eval(__proc$Script("script"))' },
            { src: 'window.eval(script)', expected: 'window.eval(__proc$Script(script))' },
            { src: 'window["eval"](script)', expected: 'window["eval"](__proc$Script(script))' },

            { src: 'eval.call(window, script)', expected: 'eval.call(window, __proc$Script(script))' },
            { src: 'eval.call(window, "script")', expected: 'eval.call(window, __proc$Script("script"))' },
            { src: 'window.eval.call(window, script)', expected: 'window.eval.call(window, __proc$Script(script))' },
            {
                src:      'window["eval"].call(window, script)',
                expected: 'window["eval"].call(window, __proc$Script(script))'
            },

            { src: 'eval.apply(window, [script])', expected: 'eval.apply(window, [__proc$Script(script)])' },
            { src: 'eval.apply(window, ["script"])', expected: 'eval.apply(window, [__proc$Script("script")])' },
            {
                src:      'window.eval.apply(window, [script])',
                expected: 'window.eval.apply(window, [__proc$Script(script)])'
            },
            {
                src:      'window["eval"].apply(window, [script])',
                expected: 'window["eval"].apply(window, [__proc$Script(script)])'
            }
        ]);
    });

    it('Should process setTimeout() with string handler', function () {
        testProcessing([
            { src: 'setTimeout(script, 0)', expected: 'setTimeout(__proc$Script(script), 0)' },
            { src: 'setTimeout("script", 0)', expected: 'setTimeout(__proc$Script("script"), 0)' },
            { src: 'window.setTimeout(script, 0)', expected: 'window.setTimeout(__proc$Script(script), 0)' },
            { src: 'window["setTimeout"](script, 0)', expected: 'window["setTimeout"](__proc$Script(script), 0)' },

            {
                src:      'setTimeout.call(window, script, 0)',
                expected: 'setTimeout.call(window, __proc$Script(script), 0)'
            },
            {
                src:      'setTimeout.call(window, "script", 0)',
                expected: 'setTimeout.call(window, __proc$Script("script"), 0)'
            },
            {
                src:      'window.setTimeout.call(window, script, 0)',
                expected: 'window.setTimeout.call(window, __proc$Script(script), 0)'
            },
            {
                src:      'window["setTimeout"].call(window, script, 0)',
                expected: 'window["setTimeout"].call(window, __proc$Script(script), 0)'
            },

            {
                src:      'setTimeout.apply(window, [script, 0])',
                expected: 'setTimeout.apply(window, [__proc$Script(script), 0])'
            },
            {
                src:      'setTimeout.apply(window, ["script", 0])',
                expected: 'setTimeout.apply(window, [__proc$Script("script"), 0])'
            },
            {
                src:      'window.setTimeout.apply(window, [script, 0])',
                expected: 'window.setTimeout.apply(window, [__proc$Script(script), 0])'
            },
            {
                src:      'window["setTimeout"].apply(window, [script, 0])',
                expected: 'window["setTimeout"].apply(window, [__proc$Script(script), 0])'
            }
        ]);
    });

    it('Should process setInterval() with string handler', function () {
        testProcessing([
            { src: 'setInterval(script, 0)', expected: 'setInterval(__proc$Script(script), 0)' },
            { src: 'setInterval("script", 0)', expected: 'setInterval(__proc$Script("script"), 0)' },
            { src: 'window.setInterval(script, 0)', expected: 'window.setInterval(__proc$Script(script), 0)' },
            { src: 'window["setInterval"](script, 0)', expected: 'window["setInterval"](__proc$Script(script), 0)' },

            {
                src:      'setInterval.call(window, script, 0)',
                expected: 'setInterval.call(window, __proc$Script(script), 0)'
            },
            {
                src:      'setInterval.call(window, "script", 0)',
                expected: 'setInterval.call(window, __proc$Script("script"), 0)'
            },
            {
                src:      'window.setInterval.call(window, script, 0)',
                expected: 'window.setInterval.call(window, __proc$Script(script), 0)'
            },
            {
                src:      'window["setInterval"].call(window, script, 0)',
                expected: 'window["setInterval"].call(window, __proc$Script(script), 0)'
            },

            {
                src:      'setInterval.apply(window, [script, 0])',
                expected: 'setInterval.apply(window, [__proc$Script(script), 0])'
            },
            {
                src:      'setInterval.apply(window, ["script", 0])',
                expected: 'setInterval.apply(window, [__proc$Script("script"), 0])'
            },
            {
                src:      'window.setInterval.apply(window, [script, 0])',
                expected: 'window.setInterval.apply(window, [__proc$Script(script), 0])'
            },
            {
                src:      'window["setInterval"].apply(window, [script, 0])',
                expected: 'window["setInterval"].apply(window, [__proc$Script(script), 0])'
            }
        ]);
    });

    it('Should process window.postMessage()', function () {
        testProcessing([
            { src: 'window.postMessage("", "")', expected: '__call$(window, "postMessage", ["", ""])' },
            { src: 'window["postMessage"]("", "")', expected: '__call$(window, "postMessage", ["", ""])' },
            { src: 'window[postMessage]("", "")', expected: '__call$(window, postMessage, ["", ""])' },
            { src: 'window["some"]("", "")', expected: 'window["some"]("", "")' },
            { src: 'window.some.("", "")', expected: 'window.some.("", "")' }
        ]);
    });

    it('Should process document.write() and document.writeln()', function () {
        var src      = 'var doc = document;' +
                       'doc.write("some html", "html");' +
                       'var g = obj.href;' +
                       'if(false){' +
                       '   doc.writeln("some html", "html");' +
                       '   g = obj.href;' +
                       '}' +
                       'doc.writeln("some html", "html");';
        var expected = 'var doc = document;' +
                       '__call$(doc, "write", ["some html", "html", "__begin$"]);' +
                       'var g = __get$(obj, "href");' +
                       'if(false){' +
                       '   __call$(doc, "writeln", ["some html", "html"]);' +
                       '   g = __get$(obj, "href");' +
                       '}' +
                       '__call$(doc, "writeln", ["some html", "html", "__end$"]);';

        testProcessing([
            { src: src, expected: expected },
            { src: 'function test(){' + src + '}', expected: 'function test(){' + expected + '}' }
        ]);
    });

    it('Should process for..in iteration', function () {
        testProcessing([
            { src: 'for(obj.prop in src){}', expected: 'for(var __set$temp in src){obj.prop = __set$temp;}' },
            { src: 'for(obj["prop"] in src){}', expected: 'for(var __set$temp in src){obj["prop"] = __set$temp;}' },
            { src: 'for(obj[i++] in src){}', expected: 'for(var __set$temp in src){__set$(obj, i++, __set$temp);}' },
            { src: 'for(obj.href in src){}', expected: 'for(var __set$temp in src){__set$(obj, "href", __set$temp);}' },
            {
                src:      'for(obj["href"] in src){}',
                expected: 'for(var __set$temp in src){__set$(obj, "href", __set$temp);}'
            }
        ]);
    });

    it('Should keep unicode identifiers', function () {
        testProcessing({
            src:      '({\\u00c0:"value"})[value]',
            expected: '__get$({\\u00c0:"value"}, value)',
            msg:      ACORN_UNICODE_PATCH_WARNING
        });
    });

    it('Should allow ES6 syntax in strict mode', function () {
        testProcessing([
            {
                src:      '"use strict";var let=0;obj.src;',
                expected: '"use strict";var let=0;__get$(obj,"src");',
                msg:      ACORN_STRICT_MODE_PATCH_WARNING
            },
            {
                src:      '"use strict";var obj={yield:function(){}};obj.src;',
                expected: '"use strict";var obj={yield:function(){/**/}};__get$(obj, "src");',
                msg:      ACORN_STRICT_MODE_PATCH_WARNING
            }
        ]);
    });

    it('Should ignore HTML comments', function () {
        testProcessing([
            { src: 'a[i];\n<!-- comment -->', expected: '__get$(a, i)' },
            { src: '<!-- comment -->\n a[i];', expected: '__get$(a, i);' },
            { src: ' <!-- comment -->\n a[i];', expected: '__get$(a, i);' },
            { src: '\n<!-- comment -->\n a[i];', expected: '__get$(a, i);' },
            { src: '<!-- comment1 -->\n<!-- comment2 -->\n a[i];', expected: '__get$(a, i);' },
            { src: '<!-- comment1 -->\n a[i];\n<!-- comment2 -->', expected: '__get$(a, i)' },
            {
                src:      'var t = "<!-- comment1 -->\\n";\na[i];',
                expected: 'var t = "<!-- comment1 -->\\n";\n__get$(a, i);'
            }
        ]);
    });

    describe('Regression', function () {
        it('Should generate empty comment inside empty function body (T170848 workaround)', function () {
            testProcessing({
                src:      'function test(){} a.src=function(){};',
                expected: 'function test(){/**/}__set$(a,"src",function(){/**/});',
                msg:      ESOTOPE_T170848_PATCH_WARNING
            });
        });

        it('Should process content in block statement (T209250)', function () {
            testProcessing({
                src:      '{ (function() { a.src = "success"; })(); }',
                expected: '{ (function() { __set$(a, "src", "success");}()); }'
            });
        });

        it('Should keep script content inside HTML comments (T226589)', function () {
            testProcessing({
                src: 'document.writeln("<!--test123-->");\n' +
                     '<!--Begin -->\n' +
                     '<!--\n' +
                     'client = "42";\n' +
                     '/* yo yo */\n' +
                     'slot = "43";\n' +
                     'width = 300;\n' +
                     'height = 250;\n' +
                     '//-->\n\n' +
                     '<!--End -->\n' +
                     'document.writeln("var t = 1;");\n' +
                     'document.writeln("t = 2;");\n' +
                     'document.close();\n',

                expected: '__call$(document, "writeln", ["<!--test123-->", \'__begin$\']);' +
                          'client = "42";' +
                          'slot = "43";' +
                          'width = 300;' +
                          'height = 250;' +
                          '__call$(document, "writeln", ["var t = 1;"]);' +
                          '__call$(document, "writeln", ["t = 2;", \'__end$\']);' +
                          'document.close();'
            });
        });

        it('Should collect document.write() and document.writeln() to get valid HTML for processing (T232454)',
            function () {
                testProcessing({
                    src: 'if(true) {\n' +
                         'document.write("<html>");\n' +
                         'document.writeln("</html>");\n' +
                         '}\n',

                    expected: 'if (true) {\n' +
                              '__call$(document, "write", ["<html>", \'__begin$\']);\n' +
                              '__call$(document, "writeln", ["</html>", \'__end$\']);\n' +
                              '}'
                });
            });

        it('Should handle malformed HTML comments (T239244)', function () {
            testProcessing({
                src: '<!-- rai_mm_tools -->\n' +
                     '<!--\n' +
                     'function test(theURL,winName,features) { //v2.0\n' +
                     '   a[i];\n' +
                     '}\n' +
                     '//-->',

                expected: 'function test(theURL,winName,features) {\n' +
                          '   __get$(a, i);\n' +
                          '}'
            });
        });

        it('Should handle malformed closing HTML comments (health monitor)', function () {
            testProcessing([
                {
                    src:      '<!--\n' + 'dn="SIDEX.RU";\n' + 'a[i]\n' + '// -->',
                    expected: 'dn="SIDEX.RU";\n' + '__get$(a, i)\n'
                },
                {
                    src:      '<!--\n' + 'dn="SIDEX.RU";\n // -->',
                    expected: '<!--\n' + 'dn="SIDEX.RU";\n // -->'
                }
            ]);
        });

        it('Should keep line after open HTML comments (health monitor)', function () {
            testProcessing({
                src: '<!--\n' +
                     'var rdm0 = "";\n' +
                     'var rdm1 = "";\n' +
                     'a[i];' +
                     '//-->',

                expected: 'var rdm0 = "";\n' +
                          'var rdm1 = "";\n' +
                          '__get$(a, i)'
            });
        });
    });
});
