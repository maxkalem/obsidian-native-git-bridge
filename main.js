/*
Obsidian Native Git Bridge - bundled output.
*/
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/@profoundlogic/hogan/lib/compiler.js
var require_compiler = __commonJS({
  "node_modules/@profoundlogic/hogan/lib/compiler.js"(exports) {
    (function(Hogan4) {
      var rIsWhitespace = /\S/, rQuot = /\"/g, rNewline = /\n/g, rCr = /\r/g, rSlash = /\\/g, rLineSep = /\u2028/, rParagraphSep = /\u2029/;
      Hogan4.tags = {
        "#": 1,
        "^": 2,
        "<": 3,
        "$": 4,
        "/": 5,
        "!": 6,
        ">": 7,
        "=": 8,
        "_v": 9,
        "{": 10,
        "&": 11,
        "_t": 12
      };
      Hogan4.scan = function scan(text, delimiters) {
        var len = text.length, IN_TEXT = 0, IN_TAG_TYPE = 1, IN_TAG = 2, state = IN_TEXT, tagType = null, tag = null, buf = "", tokens = [], seenTag = false, i = 0, lineStart = 0, otag = "{{", ctag = "}}";
        function addBuf() {
          if (buf.length > 0) {
            tokens.push({ tag: "_t", text: new String(buf) });
            buf = "";
          }
        }
        function lineIsWhitespace() {
          var isAllWhitespace = true;
          for (var j = lineStart; j < tokens.length; j++) {
            isAllWhitespace = Hogan4.tags[tokens[j].tag] < Hogan4.tags["_v"] || tokens[j].tag == "_t" && tokens[j].text.match(rIsWhitespace) === null;
            if (!isAllWhitespace) {
              return false;
            }
          }
          return isAllWhitespace;
        }
        function filterLine(haveSeenTag, noNewLine) {
          addBuf();
          if (haveSeenTag && lineIsWhitespace()) {
            for (var j = lineStart, next; j < tokens.length; j++) {
              if (tokens[j].text) {
                if ((next = tokens[j + 1]) && next.tag == ">") {
                  next.indent = tokens[j].text.toString();
                }
                tokens.splice(j, 1);
              }
            }
          } else if (!noNewLine) {
            tokens.push({ tag: "\n" });
          }
          seenTag = false;
          lineStart = tokens.length;
        }
        function changeDelimiters(text2, index) {
          var close = "=" + ctag, closeIndex = text2.indexOf(close, index), delimiters2 = trim(
            text2.substring(text2.indexOf("=", index) + 1, closeIndex)
          ).split(" ");
          otag = delimiters2[0];
          ctag = delimiters2[delimiters2.length - 1];
          return closeIndex + close.length - 1;
        }
        if (delimiters) {
          delimiters = delimiters.split(" ");
          otag = delimiters[0];
          ctag = delimiters[1];
        }
        for (i = 0; i < len; i++) {
          if (state == IN_TEXT) {
            if (tagChange(otag, text, i)) {
              --i;
              addBuf();
              state = IN_TAG_TYPE;
            } else {
              if (text.charAt(i) == "\n") {
                filterLine(seenTag);
              } else {
                buf += text.charAt(i);
              }
            }
          } else if (state == IN_TAG_TYPE) {
            i += otag.length - 1;
            tag = Hogan4.tags[text.charAt(i + 1)];
            tagType = tag ? text.charAt(i + 1) : "_v";
            if (tagType == "=") {
              i = changeDelimiters(text, i);
              state = IN_TEXT;
            } else {
              if (tag) {
                i++;
              }
              state = IN_TAG;
            }
            seenTag = i;
          } else {
            if (tagChange(ctag, text, i)) {
              tokens.push({
                tag: tagType,
                n: trim(buf),
                otag,
                ctag,
                i: tagType == "/" ? seenTag - otag.length : i + ctag.length
              });
              buf = "";
              i += ctag.length - 1;
              state = IN_TEXT;
              if (tagType == "{") {
                if (ctag == "}}") {
                  i++;
                } else {
                  cleanTripleStache(tokens[tokens.length - 1]);
                }
              }
            } else {
              buf += text.charAt(i);
            }
          }
        }
        filterLine(seenTag, true);
        return tokens;
      };
      function cleanTripleStache(token) {
        if (token.n.substr(token.n.length - 1) === "}") {
          token.n = token.n.substring(0, token.n.length - 1);
        }
      }
      function trim(s) {
        if (s.trim) {
          return s.trim();
        }
        return s.replace(/^\s*|\s*$/g, "");
      }
      function tagChange(tag, text, index) {
        if (text.charAt(index) != tag.charAt(0)) {
          return false;
        }
        for (var i = 1, l = tag.length; i < l; i++) {
          if (text.charAt(index + i) != tag.charAt(i)) {
            return false;
          }
        }
        return true;
      }
      var allowedInSuper = { "_t": true, "\n": true, "$": true, "/": true };
      function buildTree(tokens, kind, stack, customTags) {
        var instructions = [], opener = null, tail = null, token = null;
        tail = stack[stack.length - 1];
        while (tokens.length > 0) {
          token = tokens.shift();
          if (tail && tail.tag == "<" && !(token.tag in allowedInSuper)) {
            throw new Error("Illegal content in < super tag.");
          }
          if (Hogan4.tags[token.tag] <= Hogan4.tags["$"] || isOpener(token, customTags)) {
            stack.push(token);
            token.nodes = buildTree(tokens, token.tag, stack, customTags);
          } else if (token.tag == "/") {
            if (stack.length === 0) {
              throw new Error("Closing tag without opener: /" + token.n);
            }
            opener = stack.pop();
            if (token.n != opener.n && !isCloser(token.n, opener.n, customTags)) {
              throw new Error("Nesting error: " + opener.n + " vs. " + token.n);
            }
            opener.end = token.i;
            return instructions;
          } else if (token.tag == "\n") {
            token.last = tokens.length == 0 || tokens[0].tag == "\n";
          }
          instructions.push(token);
        }
        if (stack.length > 0) {
          throw new Error("missing closing tag: " + stack.pop().n);
        }
        return instructions;
      }
      function isOpener(token, tags) {
        for (var i = 0, l = tags.length; i < l; i++) {
          if (tags[i].o == token.n) {
            token.tag = "#";
            return true;
          }
        }
      }
      function isCloser(close, open, tags) {
        for (var i = 0, l = tags.length; i < l; i++) {
          if (tags[i].c == close && tags[i].o == open) {
            return true;
          }
        }
      }
      function stringifySubstitutions(obj) {
        var items = [];
        for (var key2 in obj) {
          items.push('"' + esc(key2) + '": function(c,p,t,i) {' + obj[key2] + "}");
        }
        return "{ " + items.join(",") + " }";
      }
      function stringifyPartials(codeObj) {
        var partials = [];
        for (var key2 in codeObj.partials) {
          partials.push('"' + esc(key2) + '":{name:"' + esc(codeObj.partials[key2].name) + '", ' + stringifyPartials(codeObj.partials[key2]) + "}");
        }
        return "partials: {" + partials.join(",") + "}, subs: " + stringifySubstitutions(codeObj.subs);
      }
      Hogan4.stringify = function(codeObj, text, options) {
        return "{code: function (c,p,i) { " + Hogan4.wrapMain(codeObj.code) + " }," + stringifyPartials(codeObj) + "}";
      };
      var serialNo = 0;
      Hogan4.generate = function(tree, text, options) {
        serialNo = 0;
        var context = { code: "", subs: {}, partials: {} };
        Hogan4.walk(tree, context);
        if (options.asString) {
          return this.stringify(context, text, options);
        }
        return this.makeTemplate(context, text, options);
      };
      Hogan4.wrapMain = function(code) {
        return 'var t=this;t.b(i=i||"");' + code + "return t.fl();";
      };
      Hogan4.template = Hogan4.Template;
      Hogan4.makeTemplate = function(codeObj, text, options) {
        var template = this.makePartials(codeObj);
        template.code = new Function("c", "p", "i", this.wrapMain(codeObj.code));
        return new this.template(template, text, this, options);
      };
      Hogan4.makePartials = function(codeObj) {
        var key2, template = { subs: {}, partials: codeObj.partials, name: codeObj.name };
        for (key2 in template.partials) {
          template.partials[key2] = this.makePartials(template.partials[key2]);
        }
        for (key2 in codeObj.subs) {
          template.subs[key2] = new Function("c", "p", "t", "i", codeObj.subs[key2]);
        }
        return template;
      };
      function esc(s) {
        return s.replace(rSlash, "\\\\").replace(rQuot, '\\"').replace(rNewline, "\\n").replace(rCr, "\\r").replace(rLineSep, "\\u2028").replace(rParagraphSep, "\\u2029");
      }
      function chooseMethod(s) {
        return ~s.indexOf(".") ? "d" : "f";
      }
      function createPartial(node, context) {
        var prefix = "<" + (context.prefix || "");
        var sym = prefix + node.n + serialNo++;
        context.partials[sym] = { name: node.n, partials: {} };
        context.code += 't.b(t.rp("' + esc(sym) + '",c,p,"' + (node.indent || "") + '"));';
        return sym;
      }
      Hogan4.codegen = {
        "#": function(node, context) {
          context.code += "if(t.s(t." + chooseMethod(node.n) + '("' + esc(node.n) + '",c,p,1),c,p,0,' + node.i + "," + node.end + ',"' + node.otag + " " + node.ctag + '")){t.rs(c,p,function(c,p,t){';
          Hogan4.walk(node.nodes, context);
          context.code += "});c.pop();}";
        },
        "^": function(node, context) {
          context.code += "if(!t.s(t." + chooseMethod(node.n) + '("' + esc(node.n) + '",c,p,1),c,p,1,0,0,"")){';
          Hogan4.walk(node.nodes, context);
          context.code += "};";
        },
        ">": createPartial,
        "<": function(node, context) {
          var ctx = { partials: {}, code: "", subs: {}, inPartial: true };
          Hogan4.walk(node.nodes, ctx);
          var template = context.partials[createPartial(node, context)];
          template.subs = ctx.subs;
          template.partials = ctx.partials;
        },
        "$": function(node, context) {
          var ctx = { subs: {}, code: "", partials: context.partials, prefix: node.n };
          Hogan4.walk(node.nodes, ctx);
          context.subs[node.n] = ctx.code;
          if (!context.inPartial) {
            context.code += 't.sub("' + esc(node.n) + '",c,p,i);';
          }
        },
        "\n": function(node, context) {
          context.code += write('"\\n"' + (node.last ? "" : " + i"));
        },
        "_v": function(node, context) {
          context.code += "t.b(t.v(t." + chooseMethod(node.n) + '("' + esc(node.n) + '",c,p,0)));';
        },
        "_t": function(node, context) {
          context.code += write('"' + esc(node.text) + '"');
        },
        "{": tripleStache,
        "&": tripleStache
      };
      function tripleStache(node, context) {
        context.code += "t.b(t.t(t." + chooseMethod(node.n) + '("' + esc(node.n) + '",c,p,0)));';
      }
      function write(s) {
        return "t.b(" + s + ");";
      }
      Hogan4.walk = function(nodelist, context) {
        var func;
        for (var i = 0, l = nodelist.length; i < l; i++) {
          func = Hogan4.codegen[nodelist[i].tag];
          func && func(nodelist[i], context);
        }
        return context;
      };
      Hogan4.parse = function(tokens, text, options) {
        options = options || {};
        return buildTree(tokens, "", [], options.sectionTags || []);
      };
      Hogan4.cache = {};
      Hogan4.cacheKey = function(text, options) {
        return [text, !!options.asString, !!options.disableLambda, options.delimiters, !!options.modelGet].join("||");
      };
      Hogan4.compile = function(text, options) {
        options = options || {};
        var key2 = Hogan4.cacheKey(text, options);
        var template = this.cache[key2];
        if (template) {
          var partials = template.partials;
          for (var name in partials) {
            delete partials[name].instance;
          }
          return template;
        }
        template = this.generate(this.parse(this.scan(text, options.delimiters), text, options), text, options);
        return this.cache[key2] = template;
      };
    })(typeof exports !== "undefined" ? exports : Hogan);
  }
});

// node_modules/@profoundlogic/hogan/lib/template.js
var require_template = __commonJS({
  "node_modules/@profoundlogic/hogan/lib/template.js"(exports) {
    var Hogan4 = {};
    (function(Hogan5) {
      Hogan5.Template = function(codeObj, text, compiler, options) {
        codeObj = codeObj || {};
        this.r = codeObj.code || this.r;
        this.c = compiler;
        this.options = options || {};
        this.text = text || "";
        this.partials = codeObj.partials || {};
        this.subs = codeObj.subs || {};
        this.buf = "";
      };
      Hogan5.Template.prototype = {
        // render: replaced by generated code.
        r: function(context, partials, indent) {
          return "";
        },
        // variable escaping
        v: hoganEscape,
        // triple stache
        t: coerceToString,
        render: function render(context, partials, indent) {
          return this.ri([context], partials || {}, indent);
        },
        // render internal -- a hook for overrides that catches partials too
        ri: function(context, partials, indent) {
          return this.r(context, partials, indent);
        },
        // ensurePartial
        ep: function(symbol, partials) {
          var partial = this.partials[symbol];
          var template = partials[partial.name];
          if (partial.instance && partial.base == template) {
            return partial.instance;
          }
          if (typeof template == "string") {
            if (!this.c) {
              throw new Error("No compiler available.");
            }
            template = this.c.compile(template, this.options);
          }
          if (!template) {
            return null;
          }
          this.partials[symbol].base = template;
          if (partial.subs) {
            if (!partials.stackText) partials.stackText = {};
            for (key in partial.subs) {
              if (!partials.stackText[key]) {
                partials.stackText[key] = this.activeSub !== void 0 && partials.stackText[this.activeSub] ? partials.stackText[this.activeSub] : this.text;
              }
            }
            template = createSpecializedPartial(
              template,
              partial.subs,
              partial.partials,
              this.stackSubs,
              this.stackPartials,
              partials.stackText
            );
          }
          this.partials[symbol].instance = template;
          return template;
        },
        // tries to find a partial in the current scope and render it
        rp: function(symbol, context, partials, indent) {
          var partial = this.ep(symbol, partials);
          if (!partial) {
            return "";
          }
          return partial.ri(context, partials, indent);
        },
        // render a section
        rs: function(context, partials, section) {
          var tail = context[context.length - 1];
          if (!isArray(tail)) {
            section(context, partials, this);
            return;
          }
          for (var i = 0; i < tail.length; i++) {
            context.push(tail[i]);
            section(context, partials, this);
            context.pop();
          }
        },
        // maybe start a section
        s: function(val, ctx, partials, inverted, start, end, tags) {
          var pass;
          if (isArray(val) && val.length === 0) {
            return false;
          }
          if (typeof val == "function") {
            val = this.ms(val, ctx, partials, inverted, start, end, tags);
          }
          pass = !!val;
          if (!inverted && pass && ctx) {
            ctx.push(typeof val == "object" ? val : ctx[ctx.length - 1]);
          }
          return pass;
        },
        // find values with dotted names
        d: function(key2, ctx, partials, returnFound) {
          var found, names = key2.split("."), val = this.f(names[0], ctx, partials, returnFound), doModelGet = this.options.modelGet, cx = null;
          if (key2 === "." && isArray(ctx[ctx.length - 2])) {
            val = ctx[ctx.length - 1];
          } else {
            for (var i = 1; i < names.length; i++) {
              found = findInScope(names[i], val, doModelGet);
              if (found !== void 0) {
                cx = val;
                val = found;
              } else {
                val = "";
              }
            }
          }
          if (returnFound && !val) {
            return false;
          }
          if (!returnFound && typeof val == "function") {
            ctx.push(cx);
            val = this.mv(val, ctx, partials);
            ctx.pop();
          }
          return val;
        },
        // find values with normal names
        f: function(key2, ctx, partials, returnFound) {
          var val = false, v = null, found = false, doModelGet = this.options.modelGet;
          for (var i = ctx.length - 1; i >= 0; i--) {
            v = ctx[i];
            val = findInScope(key2, v, doModelGet);
            if (val !== void 0) {
              found = true;
              break;
            }
          }
          if (!found) {
            return returnFound ? false : "";
          }
          if (!returnFound && typeof val == "function") {
            val = this.mv(val, ctx, partials);
          }
          return val;
        },
        // higher order templates
        ls: function(func, cx, ctx, partials, text, tags) {
          var oldTags = this.options.delimiters;
          this.options.delimiters = tags;
          this.b(this.ct(coerceToString(func.call(cx, text, ctx)), cx, partials));
          this.options.delimiters = oldTags;
          return false;
        },
        // compile text
        ct: function(text, cx, partials) {
          if (this.options.disableLambda) {
            throw new Error("Lambda features disabled.");
          }
          return this.c.compile(text, this.options).render(cx, partials);
        },
        // template result buffering
        b: function(s) {
          this.buf += s;
        },
        fl: function() {
          var r = this.buf;
          this.buf = "";
          return r;
        },
        // method replace section
        ms: function(func, ctx, partials, inverted, start, end, tags) {
          var textSource, cx = ctx[ctx.length - 1], result = func.call(cx);
          if (typeof result == "function") {
            if (inverted) {
              return true;
            } else {
              textSource = this.activeSub && this.subsText && this.subsText[this.activeSub] ? this.subsText[this.activeSub] : this.text;
              return this.ls(result, cx, ctx, partials, textSource.substring(start, end), tags);
            }
          }
          return result;
        },
        // method replace variable
        mv: function(func, ctx, partials) {
          var cx = ctx[ctx.length - 1];
          var result = func.call(cx);
          if (typeof result == "function") {
            return this.ct(coerceToString(result.call(cx)), cx, partials);
          }
          return result;
        },
        sub: function(name, context, partials, indent) {
          var f = this.subs[name];
          if (f) {
            this.activeSub = name;
            f(context, partials, this, indent);
            this.activeSub = false;
          }
        }
      };
      function findInScope(key2, scope, doModelGet) {
        var val;
        if (scope && typeof scope == "object") {
          if (scope[key2] !== void 0) {
            val = scope[key2];
          } else if (doModelGet && scope.get && typeof scope.get == "function") {
            val = scope.get(key2);
          }
        }
        return val;
      }
      function createSpecializedPartial(instance, subs, partials, stackSubs, stackPartials, stackText) {
        function PartialTemplate() {
        }
        ;
        PartialTemplate.prototype = instance;
        function Substitutions() {
        }
        ;
        Substitutions.prototype = instance.subs;
        var key2;
        var partial = new PartialTemplate();
        partial.subs = new Substitutions();
        partial.subsText = {};
        partial.buf = "";
        stackSubs = stackSubs || {};
        partial.stackSubs = stackSubs;
        partial.subsText = stackText;
        for (key2 in subs) {
          if (!stackSubs[key2]) stackSubs[key2] = subs[key2];
        }
        for (key2 in stackSubs) {
          partial.subs[key2] = stackSubs[key2];
        }
        stackPartials = stackPartials || {};
        partial.stackPartials = stackPartials;
        for (key2 in partials) {
          if (!stackPartials[key2]) stackPartials[key2] = partials[key2];
        }
        for (key2 in stackPartials) {
          partial.partials[key2] = stackPartials[key2];
        }
        return partial;
      }
      var rAmp = /&/g, rLt = /</g, rGt = />/g, rApos = /\'/g, rQuot = /\"/g, hChars = /[&<>\"\']/;
      function coerceToString(val) {
        return String(val === null || val === void 0 ? "" : val);
      }
      function hoganEscape(str) {
        str = coerceToString(str);
        return hChars.test(str) ? str.replace(rAmp, "&amp;").replace(rLt, "&lt;").replace(rGt, "&gt;").replace(rApos, "&#39;").replace(rQuot, "&quot;") : str;
      }
      var isArray = Array.isArray || function(a) {
        return Object.prototype.toString.call(a) === "[object Array]";
      };
    })(typeof exports !== "undefined" ? exports : Hogan4);
  }
});

// node_modules/@profoundlogic/hogan/lib/hogan.js
var require_hogan = __commonJS({
  "node_modules/@profoundlogic/hogan/lib/hogan.js"(exports, module2) {
    var Hogan4 = require_compiler();
    Hogan4.Template = require_template().Template;
    Hogan4.template = Hogan4.Template;
    module2.exports = Hogan4;
  }
});

// src/main.ts
var main_exports = {};
__export(main_exports, {
  compareVersions: () => compareVersions,
  default: () => NativeGitBridgePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian15 = require("obsidian");

// src/constants.ts
var PLUGIN_ID = "native-git-bridge";
var PROTOCOL_VERSION = 1;
var RUNNER_MIN_VERSION = 11;
var EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
var DEFAULT_PROTECTED_PATHS = [];
var RUNTIME_DIR_NAME = "runtime";
var REQUESTS_DIR = "requests";
var RESULTS_DIR = "results";
var CANCEL_DIR = "cancel";
var DONE_DIR = "done";
var POLL_INTERVAL_MS = 400;
var DEFAULT_TIMEOUT_SECONDS = 90;
var ACTION_TIMEOUT_SECONDS = {
  "clone-into-vault": 900,
  "adopt-remote": 900
};
var RESULT_RETENTION_MS = 24 * 60 * 60 * 1e3;
var STALE_LOCK_MS = 30 * 60 * 1e3;
var DISPLAY_OUTPUT_LIMIT = 100 * 1024;
var LOG_MAX_ENTRIES = 200;
var SPARSE_SAFETY_WARNING = "Sparse checkout safety check failed. The excluded directories appear as Git changes. No commit or push was performed.";
var STORAGE_PREFIX = "ngb:v1";
var REPO_URL = "https://github.com/maxkalem/obsidian-native-git-bridge";
function bootstrapCommand(pluginVersion, repoPathHint) {
  const base = /^\d+\.\d+\.\d+$/.test(pluginVersion) ? `${REPO_URL}/releases/download/${pluginVersion}` : `${REPO_URL}/releases/latest/download`;
  const cmd = `curl -fsSL ${base}/bootstrap.sh | NGB_VERSION=${pluginVersion} bash -s --`;
  return repoPathHint ? `${cmd} "${repoPathHint}"` : cmd;
}
function bootstrapCommandLocal(vaultPath, configDir) {
  const base = `${vaultPath}/${configDir}/plugins/${PLUGIN_ID}/termux`;
  return `bash "${base}/bootstrap.sh" "${vaultPath}"`;
}
var PAIRING_FILE = "pairing.json";
var CLAIM_FILE = "claim.json";
var PROFILE_MARKER_FILE = "profile.json";
var PAIRING_WAIT_MS = 2e4;
var COMPANION_SETUP_URI = "nativegitbridge://setup";
var COMPANION_RELEASES_URL = "https://github.com/maxkalem/obsidian-native-git-bridge/releases/latest";
var COMPANION_OPEN_TERMUX_URI = "nativegitbridge://open-termux";
var COMPANION_DOWNLOAD_APK_URI = "nativegitbridge://download-apk";
var TERMUX_SITE_URL = "https://termux.dev";
var TERMUX_FDROID_URL = "https://f-droid.org/packages/com.termux/";
var COMPANION_GET_TERMUX_URI = "nativegitbridge://get-termux";
var RUNNER_OUTDATED_HINT = "The Termux runner script is outdated. Updating the plugin does not update it \u2014 re-run the install command in Termux (Settings -> Native Git Bridge -> Copy command, or the 'Set up Termux' button in the companion app).";

// src/types.ts
var ACTION_MIN_RUNNER = /* @__PURE__ */ new Map([
  ["sparse-exclude-add", 4],
  ["sparse-exclude-remove", 4],
  ["exclude-add", 4],
  ["exclude-remove", 4],
  ["exclude-list", 4],
  ["repo-log", 5],
  ["resolve-conflict", 6],
  ["discard-all", 8],
  ["reset-all", 8],
  ["init-repo", 11],
  ["set-remote", 11],
  ["clone-into-vault", 11],
  ["adopt-remote", 11]
]);
var MUTATING_ACTIONS = /* @__PURE__ */ new Set([
  "sparse-reapply",
  "pull",
  "commit",
  "push",
  "sync",
  "restore-file",
  "abort-merge",
  "stage-file",
  "unstage-file",
  "discard-file",
  "stage-all",
  "unstage-all",
  "resolve-conflict",
  "discard-all",
  "reset-all",
  "init-repo",
  "set-remote",
  "clone-into-vault",
  "adopt-remote"
]);

// src/settings/DeviceLocalSettingsStore.ts
var CURRENT_SCHEMA_VERSION = 1;
var DEFAULT_DEVICE_SETTINGS = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  enabledOnThisDevice: false,
  termuxIntegrationEnabled: false,
  repoPathHint: "",
  authToken: "",
  profileId: "",
  protectedPaths: [...DEFAULT_PROTECTED_PATHS],
  derivedProtectedPaths: [],
  autoProtectSparse: true,
  opTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  autoPullOnOpen: false,
  autoSyncOnClose: false,
  periodicSyncMinutes: 0,
  minAutoSyncIntervalMinutes: 15,
  wifiOnly: false,
  skipOnLowBattery: false,
  companionUriTemplate: "nativegitbridge://run?id={id}",
  showSuccessModals: false,
  notificationMode: "notice",
  suppressObsidianGitWarning: false,
  menuGitignore: true,
  menuSparse: true,
  menuExclude: true,
  statusRefreshSeconds: 0,
  previousRepoRemindedAt: 0,
  previousRepoDismissed: []
};
var DeviceLocalSettingsStore = class {
  constructor(backend, scopeId) {
    this.backend = backend;
    this.scopeId = scopeId;
    this.memory = /* @__PURE__ */ new Map();
    this.volatile = false;
    if (!backend) this.volatile = true;
  }
  get isVolatile() {
    return this.volatile;
  }
  key(suffix2 = "settings") {
    return `${STORAGE_PREFIX}:${this.scopeId}:${suffix2}`;
  }
  rawGet(key2) {
    if (!this.volatile && this.backend) {
      try {
        return this.backend.getItem(key2);
      } catch {
        this.volatile = true;
      }
    }
    return this.memory.get(key2) ?? null;
  }
  rawSet(key2, value) {
    if (!this.volatile && this.backend) {
      try {
        this.backend.setItem(key2, value);
        return;
      } catch {
        this.volatile = true;
      }
    }
    this.memory.set(key2, value);
  }
  rawRemove(key2) {
    if (!this.volatile && this.backend) {
      try {
        this.backend.removeItem(key2);
      } catch {
        this.volatile = true;
      }
    }
    this.memory.delete(key2);
  }
  /** Read settings, merging defaults and migrating older schemas. */
  read() {
    const raw = this.rawGet(this.key());
    if (raw === null) return freshDefaults();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.rawSet(this.key("corrupt"), raw);
      return freshDefaults();
    }
    return this.migrate(parsed);
  }
  /** Shallow-merge a patch and persist; returns the new settings. */
  write(patch) {
    const next = { ...this.read(), ...patch, schemaVersion: CURRENT_SCHEMA_VERSION };
    this.rawSet(this.key(), JSON.stringify(next));
    return next;
  }
  reset() {
    this.rawRemove(this.key());
  }
  /** Migration entry point; extend per schema bump. */
  migrate(parsed) {
    const obj = typeof parsed === "object" && parsed !== null ? parsed : {};
    const merged = {
      ...freshDefaults(),
      ...pickKnown(obj),
      schemaVersion: CURRENT_SCHEMA_VERSION
    };
    if (!Array.isArray(merged.protectedPaths) || merged.protectedPaths.some((p) => typeof p !== "string")) {
      merged.protectedPaths = [...DEFAULT_PROTECTED_PATHS];
    }
    if (!Array.isArray(merged.derivedProtectedPaths) || merged.derivedProtectedPaths.some((p) => typeof p !== "string")) {
      merged.derivedProtectedPaths = [];
    }
    if (!Array.isArray(merged.previousRepoDismissed) || merged.previousRepoDismissed.some((p) => typeof p !== "string")) {
      merged.previousRepoDismissed = [];
    }
    return merged;
  }
  /** Generic scoped value access for auxiliary device-local state (log, operation markers). */
  getValue(suffix2) {
    return this.rawGet(this.key(suffix2));
  }
  setValue(suffix2, value) {
    this.rawSet(this.key(suffix2), value);
  }
  removeValue(suffix2) {
    this.rawRemove(this.key(suffix2));
  }
};
function freshDefaults() {
  return { ...DEFAULT_DEVICE_SETTINGS, protectedPaths: [...DEFAULT_DEVICE_SETTINGS.protectedPaths] };
}
function pickKnown(obj) {
  const out = {};
  for (const k of Object.keys(DEFAULT_DEVICE_SETTINGS)) {
    const defVal = DEFAULT_DEVICE_SETTINGS[k];
    if (k in obj && typeof obj[k] === typeof defVal && Array.isArray(obj[k]) === Array.isArray(defVal)) {
      out[k] = obj[k];
    }
  }
  return out;
}

// src/settings/SettingsTab.ts
var import_obsidian4 = require("obsidian");

// src/settings/pathValidation.ts
function hasControlChars(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 31 || c === 127) return true;
  }
  return false;
}
function validateRepoRelativePath(input) {
  if (typeof input !== "string") return { ok: false, reason: "Not a string." };
  let p = input.trim();
  if (p === "") return { ok: false, reason: "Empty path." };
  if (hasControlChars(p)) return { ok: false, reason: "Control characters are not allowed." };
  p = p.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(p)) return { ok: false, reason: "Absolute (drive) paths are not allowed." };
  if (p.startsWith("/")) return { ok: false, reason: "Absolute paths are not allowed." };
  if (p.startsWith("~")) return { ok: false, reason: "Home-relative paths are not allowed." };
  if (p.startsWith(":")) return { ok: false, reason: "Paths must not start with ':' (git pathspec magic)." };
  p = p.replace(/\/{2,}/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  p = p.replace(/\/+$/, "");
  if (p === "" || p === ".") return { ok: false, reason: "Path resolves to the repository root." };
  const segments = p.split("/");
  if (segments.some((s) => s === "..")) return { ok: false, reason: "Path traversal ('..') is not allowed." };
  if (segments.some((s) => s === "")) return { ok: false, reason: "Empty path segment." };
  if (segments.some((s) => s.toLowerCase() === ".git"))
    return { ok: false, reason: "Paths inside .git are not allowed." };
  return { ok: true, normalized: p };
}
function validateProtectedPaths(inputs) {
  const out = [];
  for (const raw of inputs) {
    const r = validateRepoRelativePath(raw);
    if (!r.ok) return { ok: false, reason: r.reason, offending: raw };
    if (!out.includes(r.normalized)) out.push(r.normalized);
  }
  return { ok: true, normalized: out };
}
function isValidRequestId(s) {
  return /^r-[0-9A-Za-z.TZ:-]{1,64}$/.test(s) && !s.includes("..");
}

// src/ui/modals.ts
var import_obsidian2 = require("obsidian");

// src/ui/copyable.ts
var import_obsidian = require("obsidian");
function addCopyButton(parent, getText, label2 = "Copy", noticeText = "Copied to clipboard.") {
  const btn = parent.createEl("button", { cls: "ngb-copy-btn" });
  const iconEl = btn.createSpan();
  (0, import_obsidian.setIcon)(iconEl, "copy");
  btn.createSpan({ text: ` ${label2}` });
  btn.addEventListener("click", () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(getText());
        new import_obsidian.Notice(noticeText);
      } catch {
        new import_obsidian.Notice("Could not access the clipboard.");
      }
    })();
  });
  return btn;
}

// src/ui/modals.ts
function placeModalAction(modal, opts) {
  const b = document.createElement("button");
  b.className = `ngb-modal-action ${opts.danger ? "mod-warning" : "mod-cta"}`;
  const ic = b.createSpan({ cls: "ngb-modal-action-icon" });
  (0, import_obsidian2.setIcon)(ic, opts.icon);
  b.createSpan({ text: opts.label });
  b.setAttribute("aria-label", opts.label);
  b.addEventListener("click", opts.onClick);
  if (import_obsidian2.Platform.isMobile && opts.hasInput === true) {
    modal.modalEl.addClass("ngb-modal-has-top-action");
    b.addClass("ngb-modal-action-top");
    modal.modalEl.insertBefore(b, modal.modalEl.firstChild);
  } else {
    const wrap = modal.contentEl.createDiv({ cls: "ngb-buttons ngb-modal-action-bottom" });
    wrap.appendChild(b);
  }
  return b;
}
function outputSection(el, label2, text) {
  if (!text || text.trim() === "") return;
  const details = el.createEl("details", { cls: "ngb-details" });
  details.createEl("summary", { text: label2 });
  const box = details.createDiv({ cls: "ngb-output" });
  const shown = text.length > DISPLAY_OUTPUT_LIMIT ? text.slice(0, DISPLAY_OUTPUT_LIMIT) + "\n\u2026 (truncated; full output in runner.log)" : text;
  box.createEl("pre", { text: shown });
}
function linkifyInto(parent, text) {
  const re = /https?:\/\/[^\s)"']+/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) parent.appendText(text.slice(last, i));
    parent.createEl("a", { href: m[0], text: m[0] });
    last = i + m[0].length;
  }
  if (last < text.length) parent.appendText(text.slice(last));
}
var ResultModal = class extends import_obsidian2.Modal {
  constructor(app, title, lines, opts = {}) {
    super(app);
    this.title = title;
    this.lines = lines;
    this.opts = opts;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText(this.title);
    const c = this.contentEl;
    const sec = c.createDiv({ cls: "ngb-section" });
    for (const line of this.lines) {
      const div = sec.createDiv({ cls: this.opts.isError ? "ngb-status-error" : "" });
      linkifyInto(div, line);
    }
    if (this.opts.actions && this.opts.actions.length > 0) {
      const fixes = c.createDiv({ cls: "ngb-buttons ngb-action-buttons" });
      for (const a of this.opts.actions) {
        const b = fixes.createEl("button", { text: a.label, cls: a.cta ? "mod-cta" : "" });
        b.addEventListener("click", () => {
          a.onClick();
          if (!a.keepOpen) this.close();
        });
      }
    }
    outputSection(c, "stdout", this.opts.stdout);
    outputSection(c, "stderr", this.opts.stderr);
    const btns = c.createDiv({ cls: "ngb-buttons" });
    addCopyButton(btns, () => this.fullText(), "Copy details", "Details copied.");
  }
  fullText() {
    const parts = [this.title, ...this.lines];
    if (this.opts.stdout) parts.push("", "--- stdout ---", this.opts.stdout);
    if (this.opts.stderr) parts.push("", "--- stderr ---", this.opts.stderr);
    return parts.join("\n");
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ConfirmModal = class extends import_obsidian2.Modal {
  constructor(app, opts, onDecision) {
    super(app);
    this.opts = opts;
    this.onDecision = onDecision;
    this.decided = false;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText(this.opts.title);
    const c = this.contentEl;
    for (const line of this.opts.body) linkifyInto(c.createEl("p"), line);
    placeModalAction(this, {
      label: this.opts.confirmLabel,
      icon: this.opts.icon ?? "check",
      danger: this.opts.danger,
      onClick: () => {
        this.decided = true;
        this.close();
        this.onDecision(true);
      }
    });
  }
  onClose() {
    if (!this.decided) this.onDecision(false);
    this.contentEl.empty();
  }
};
var ChangedFilesModal = class extends import_obsidian2.Modal {
  constructor(app, status, fetchedAt) {
    super(app);
    this.status = status;
    this.fetchedAt = fetchedAt;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Native Git: changed files");
    const c = this.contentEl;
    c.createDiv({
      cls: "ngb-settings-note",
      text: `Branch ${this.status.branch ?? "(detached)"} \xB7 \u2191${this.status.ahead} \u2193${this.status.behind} \xB7 as of ${this.fetchedAt}`
    });
    const groups = [
      ["Conflicted", this.status.conflicted.map((e) => ({ path: e.path, badge: "!" }))],
      ["Staged", this.status.staged.map((e) => ({ path: e.path, badge: e.index }))],
      ["Unstaged", this.status.unstaged.map((e) => ({ path: e.path, badge: e.worktree }))],
      ["Untracked", this.status.untracked.map((p) => ({ path: p, badge: "?" }))]
    ];
    let any = false;
    for (const [name, items] of groups) {
      if (items.length === 0) continue;
      any = true;
      const sec = c.createDiv({ cls: "ngb-section" });
      sec.createEl("h3", { text: `${name} (${items.length})` });
      const ul = sec.createEl("ul", { cls: "ngb-file-list" });
      for (const it of items) {
        const li = ul.createEl("li");
        li.createSpan({ cls: "ngb-badge", text: it.badge });
        li.createSpan({ text: it.path });
      }
    }
    if (!any) c.createEl("p", { cls: "ngb-ok", text: "Working tree clean." });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var SparseSafetyModal = class extends import_obsidian2.Modal {
  constructor(app, report, warningText, fixes) {
    super(app);
    this.report = report;
    this.warningText = warningText;
    this.fixes = fixes;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Sparse checkout safety check");
    const c = this.contentEl;
    if (this.report.safe) {
      c.createEl("p", {
        cls: "ngb-ok",
        text: "Safe: no protected sparse path appears as a Git change."
      });
    } else {
      c.createDiv({ cls: "ngb-warning", text: this.warningText });
      const ul = c.createEl("ul", { cls: "ngb-file-list" });
      for (const v of this.report.violations) {
        ul.createEl("li", { text: `${v.path} \u2014 ${v.status} (${v.source})` });
      }
      c.createEl("p", {
        cls: "ngb-settings-note",
        text: "Nothing is repaired automatically. The two fixes below are the usual ones; 'Run diagnostics' inspects the sparse state, and anything else is resolved in Termux."
      });
      this.renderFixes(c);
    }
    c.createDiv({
      cls: "ngb-settings-note",
      text: `Protected paths: ${this.report.protectedPaths.join(", ")} \xB7 checked ${this.report.checkedAt}`
    });
  }
  /**
   * The two recoveries that actually apply here, side by side. Both stay on
   * one row on a phone: equal flex widths, small type, labels truncated
   * rather than wrapped, and the detail spelled out underneath instead of in
   * the button.
   */
  renderFixes(c) {
    if (!this.fixes) return;
    const isNew = (s) => s === "untracked" || s === "added";
    const other = new Set(
      this.report.violations.filter((v) => !isNew(v.status)).map((v) => v.path)
    );
    const paths = [
      ...new Set(
        this.report.violations.filter((v) => isNew(v.status) && !other.has(v.path)).map((v) => v.path)
      )
    ];
    const allPaths = [...new Set(this.report.violations.map((v) => v.path))];
    const dirs = this.report.protectedPaths.filter(
      (p) => allPaths.some((f) => f === p || f.startsWith(`${p}/`))
    );
    if (paths.length === 0 && dirs.length === 0) return;
    const row = c.createDiv({ cls: "ngb-fix-row" });
    if (paths.length > 0) {
      const b = row.createEl("button", { cls: "ngb-fix-btn mod-warning", text: "Delete files locally" });
      b.setAttribute("aria-label", `Move ${paths.length} listed files to Obsidian's trash`);
      b.addEventListener("click", () => {
        this.close();
        this.fixes?.deleteLocally(paths);
      });
    }
    if (dirs.length > 0) {
      const b = row.createEl("button", { cls: "ngb-fix-btn", text: "Unprotect path" });
      b.setAttribute("aria-label", `Remove ${dirs.join(", ")} from the sparse exclusions`);
      b.addEventListener("click", () => {
        this.close();
        this.fixes?.unprotect(dirs);
      });
    }
    const notes = [];
    if (paths.length > 0) {
      notes.push(
        `Delete: moves ${paths.length} new file${paths.length === 1 ? "" : "s"} to Obsidian's trash (reversible; git history untouched).`
      );
    }
    if (other.size > 0) {
      notes.push(
        `${other.size} listed path${other.size === 1 ? " is" : "s are"} tracked here, so deleting would create the very deletion this check blocks. Resolve those in Termux.`
      );
    }
    if (dirs.length > 0) {
      notes.push(
        `Unprotect: removes ${dirs.join(", ")} from the sparse exclusions, so it is checked out and committed like any other directory.`
      );
    }
    c.createDiv({ cls: "ngb-settings-note", text: notes.join(" ") });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var StatusModal = class extends import_obsidian2.Modal {
  constructor(app, data) {
    super(app);
    this.data = data;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Native Git: status");
    const c = this.contentEl;
    const kv = c.createDiv({ cls: "ngb-kv" });
    const row = (k, v) => {
      kv.createDiv({ cls: "k", text: k });
      kv.createDiv({ text: v });
    };
    const s = this.data.status;
    if (s) {
      row("Branch", s.detached ? "(detached)" : s.branch ?? "?");
      row("Upstream", s.upstream ?? "\u2014");
      row("Ahead / behind", `${s.ahead} / ${s.behind}`);
      row("Staged", String(s.staged.length));
      row("Unstaged", String(s.unstaged.length));
      row("Untracked", String(s.untracked.length));
      row("Conflicted", String(s.conflicted.length));
    } else {
      row("Status", "not fetched yet");
    }
    if (this.data.lastCommit) {
      row(
        "Last commit",
        `${this.data.lastCommit.hash.slice(0, 8)} \xB7 ${this.data.lastCommit.subject}`
      );
    }
    const sp = this.data.sparse;
    if (sp) {
      row("Sparse checkout", sp.enabled ? "enabled" : "disabled");
      row("Sparse mode", sp.coneMode === void 0 ? "\u2014" : sp.coneMode ? "cone" : "non-cone");
      row("Sparse patterns", String(sp.patterns.length));
      row("Skip-worktree entries", String(sp.skipWorktreeCount));
    }
    row("Bridge", this.data.bridgeAvailable);
    row("Active operation", this.data.activeOperation ?? "none");
    row("Last successful sync", this.data.lastSyncAt ?? "never");
    if (this.data.fetchedAt) row("Fetched", this.data.fetchedAt);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var TextPreviewModal = class extends import_obsidian2.Modal {
  constructor(app, title, meta, text) {
    super(app);
    this.title = title;
    this.meta = meta;
    this.text = text;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText(this.title);
    const c = this.contentEl;
    c.createDiv({ cls: "ngb-settings-note", text: this.meta });
    const box = c.createDiv({ cls: "ngb-output ngb-output-tall" });
    box.createEl("pre", { text: this.text });
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/ui/OperationLogModal.ts
var import_obsidian3 = require("obsidian");
var OperationLogModal = class extends import_obsidian3.Modal {
  constructor(app, log) {
    super(app);
    this.log = log;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Native Git Bridge: operation log");
    const c = this.contentEl;
    const topBar = c.createDiv({ cls: "ngb-buttons ngb-buttons-top" });
    addCopyButton(topBar, () => this.logAsText(), "Copy log", "Log copied.");
    const clearTop = topBar.createEl("button", { text: "Clear log" });
    clearTop.addEventListener("click", () => {
      this.log.clear();
      this.close();
    });
    const entries = this.log.list();
    if (entries.length === 0) {
      c.createEl("p", { text: "Log is empty." });
    } else {
      const box = c.createDiv({ cls: "ngb-output" });
      for (const e of [...entries].reverse()) {
        const line = box.createDiv({ cls: "ngb-mono" });
        line.createSpan({
          text: `${e.ts} [${e.level}] ${e.action}: ${e.message}`,
          cls: e.level === "error" ? "ngb-status-error" : e.level === "warn" ? "ngb-status-waiting" : ""
        });
        if (e.detail) {
          const details = box.createEl("details", { cls: "ngb-details" });
          details.createEl("summary", { text: "detail" });
          details.createEl("pre", { text: e.detail, cls: "ngb-mono" });
        }
      }
    }
  }
  logAsText() {
    return this.log.list().map((e) => `${e.ts} [${e.level}] ${e.action}: ${e.message}${e.detail ? "\n  " + e.detail.replace(/\n/g, "\n  ") : ""}`).join("\n");
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/ui/colors.ts
var DEFAULT_COLORS = {
  dark: {
    diffAddBg: "#1e4620",
    diffAddHl: "#2f8f2f",
    diffDelBg: "#4a1f22",
    diffDelHl: "#AA1414",
    conflictLocalBg: "#14361f",
    conflictRemoteBg: "#12283f"
  },
  light: {
    diffAddBg: "#d7f5d7",
    diffAddHl: "#7fd07f",
    diffDelBg: "#ffd9dc",
    diffDelHl: "#AA1414",
    conflictLocalBg: "#e6f7ec",
    conflictRemoteBg: "#e3eefb"
  }
};
var DIFF_COLOR_VARS = [
  "--ngb-diff-ins-bg",
  "--ngb-diff-ins-hl",
  "--ngb-diff-del-bg",
  "--ngb-diff-del-hl"
];
var CONFLICT_COLOR_VARS = ["--ngb-conf-ours-bg", "--ngb-conf-theirs-bg"];
function diffColorVars(set) {
  return {
    "--ngb-diff-ins-bg": set.diffAddBg,
    "--ngb-diff-ins-hl": set.diffAddHl,
    "--ngb-diff-del-bg": set.diffDelBg,
    "--ngb-diff-del-hl": set.diffDelHl
  };
}
function conflictColorVars(set) {
  return {
    "--ngb-conf-ours-bg": set.conflictLocalBg,
    "--ngb-conf-theirs-bg": set.conflictRemoteBg
  };
}
var HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function sanitizeColorSet(raw, mode) {
  const base = DEFAULT_COLORS[mode];
  const out = { ...base };
  if (typeof raw !== "object" || raw === null) return out;
  const r = raw;
  for (const k of Object.keys(base)) {
    const v = r[k];
    if (typeof v === "string" && HEX.test(v)) out[k] = v;
  }
  return out;
}

// src/git/previousRepos.ts
var PREVIOUS_GIT_PREFIX = "previous-git-";
var DIR_RE = /^previous-git-\d{8}T\d{6}Z$/;
function isPreviousRepoDir(name) {
  return DIR_RE.test(name);
}
function parsePreviousRepo(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw;
  if (typeof r.dir !== "string" || !isPreviousRepoDir(r.dir)) return null;
  const num = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  const str = (v) => typeof v === "string" ? v : "";
  return {
    dir: r.dir,
    createdAt: str(r.createdAt),
    sizeKb: num(r.sizeKb),
    commits: num(r.commits),
    branch: str(r.branch),
    lastCommit: str(r.lastCommit)
  };
}
function formatSize(sizeKb) {
  if (sizeKb <= 0) return "unknown size";
  if (sizeKb < 1024) return `${sizeKb} KB`;
  const mb = sizeKb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
function describePreviousRepo(r, now = /* @__PURE__ */ new Date()) {
  const parts = [formatSize(r.sizeKb)];
  if (r.commits > 0) parts.push(`${r.commits} commit${r.commits === 1 ? "" : "s"}`);
  if (r.branch) parts.push(r.branch);
  const days = daysSince(r.createdAt, now);
  if (days !== null) parts.push(days === 0 ? "set aside today" : `set aside ${days} day${days === 1 ? "" : "s"} ago`);
  return parts.join(" \xB7 ");
}
function daysSince(iso, now = /* @__PURE__ */ new Date()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 864e5));
}
var REMIND_INTERVAL_MS = 24 * 60 * 60 * 1e3;
function reposToRemindAbout(repos, state, now = Date.now()) {
  if (now - state.lastRemindedAt < REMIND_INTERVAL_MS) return [];
  return repos.filter((r) => !state.dismissed.includes(r.dir));
}

// src/settings/SettingsTab.ts
var import_obsidian5 = require("obsidian");
var NativeGitBridgeSettingTab = class extends import_obsidian4.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    // ------------------------------------------------ collapsible rule managers
    /**
     * Which sections the user has expanded. Add/remove actions re-render the
     * whole tab (display()), which would otherwise collapse every <details>
     * back to its default state — remembering titles here keeps them open.
     */
    this.openSections = /* @__PURE__ */ new Set();
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.deviceSettings;
    if (!import_obsidian4.Platform.isAndroidApp) {
      containerEl.createDiv({
        cls: "ngb-warning",
        text: "Native Git Bridge works on Android only: it delegates every Git operation to the real git binary inside Termux, triggered through a companion app. There is nothing to configure on this device \u2014 on desktop, use git directly or the obsidian-git plugin. Settings appear when you open this tab on your Android device (they are stored per device and never synced through the vault)."
      });
      return;
    }
    const advice = this.plugin.versionAdvice();
    const stale = (part) => advice.some((a) => a.part === part);
    const badge = (text, part) => ver.createSpan({
      cls: stale(part) ? "ngb-version-badge ngb-version-stale" : "ngb-version-badge",
      text
    });
    const ver = containerEl.createDiv({ cls: "ngb-version-row" });
    badge(`Plugin ${this.plugin.manifest.version}`, "plugin");
    const rv = this.plugin.lastRunnerVersion;
    badge(
      rv === 0 ? `Runner: unknown` : rv === RUNNER_MIN_VERSION ? `Runner v${rv}` : `Runner v${rv} (needs v${RUNNER_MIN_VERSION})`,
      "runner"
    );
    badge(
      this.plugin.lastCompanionVersion !== "" ? `Companion ${this.plugin.lastCompanionVersion}` : "Companion: not seen yet",
      "companion"
    );
    for (const a of advice) {
      const box = containerEl.createDiv({ cls: "ngb-warning" });
      box.createDiv({ text: a.text });
      const btns = box.createDiv({ cls: "ngb-add-row" });
      if (a.part === "runner") {
        const b = btns.createEl("button", { text: "Copy command & open Termux", cls: "mod-cta" });
        b.addEventListener("click", () => this.plugin.copyCommandAndOpenTermux());
      } else {
        const b = btns.createEl("button", { text: "Open latest release", cls: "mod-cta" });
        b.addEventListener("click", () => this.plugin.openLatestRelease());
      }
    }
    containerEl.createEl("p", {
      cls: "ngb-settings-note",
      text: "All settings below are stored on this device only (never synced through the vault), so each device can be enabled and configured independently."
    });
    if (this.plugin.store.isVolatile) {
      containerEl.createDiv({
        cls: "ngb-warning",
        text: "Device-local storage is unavailable; settings will not survive an app restart. Check available storage / WebView state."
      });
    }
    new import_obsidian4.Setting(containerEl).setName("Setup (one line in Termux)").setHeading();
    const cmd = this.plugin.installCommand();
    const cmdBox = containerEl.createDiv({ cls: "ngb-cmd" });
    cmdBox.setText(cmd);
    cmdBox.setAttribute("aria-label", "Install command");
    new import_obsidian4.Setting(containerEl).setName("Install command").setDesc(
      "Install Termux (F-Droid) and the Git Bridge Companion app, then paste this single command into Termux. It finds your vault automatically, installs git/jq/openssh, links storage, enables the companion trigger, verifies the repo and pairs with this plugin \u2014 no manual token copying. The Companion app has a 'Set up Termux' button that copies this command and opens Termux for you."
    ).addButton(
      (b) => b.setButtonText("Copy command").setCta().onClick(() => {
        void (async () => {
          await navigator.clipboard.writeText(cmd);
          new import_obsidian5.Notice("Install command copied.");
        })();
      })
    );
    const localCmd = this.plugin.installCommandLocal();
    if (localCmd !== null) {
      const localBox = containerEl.createDiv({ cls: "ngb-cmd" });
      localBox.setText(localCmd);
      localBox.setAttribute("aria-label", "Offline install command");
      new import_obsidian4.Setting(containerEl).setName("Install without a network").setDesc(
        "The Termux scripts ship inside this plugin's folder, so the vault on this device already carries them. This command installs and updates the runner from there \u2014 no GitHub, no downloads. Useful on a bad connection, and when the runner is behind after the plugin arrived through vault sync."
      ).addButton(
        (b) => b.setButtonText("Copy offline command").onClick(() => {
          void (async () => {
            await navigator.clipboard.writeText(localCmd);
            new import_obsidian5.Notice("Offline install command copied.");
          })();
        })
      );
    }
    new import_obsidian4.Setting(containerEl).setName("Setup guide").setDesc(
      "The three parts in order (Termux, companion app, one pasted command) with the current state of this device and one-tap actions."
    ).addButton(
      (b) => b.setButtonText("Open setup guide").setCta().onClick(() => this.plugin.openSetupGuide("Setup guide."))
    );
    new import_obsidian4.Setting(containerEl).setName("Companion app checklist").setDesc(
      "Opens the Git Bridge Companion setup screen: Termux detected, 'Run commands in Termux' permission, and a live round-trip test. Open it whenever operations time out."
    ).addButton(
      (b) => b.setButtonText("Open companion setup").onClick(() => void this.plugin.openCompanionSetup())
    );
    new import_obsidian4.Setting(containerEl).setName("Enable on this device").setDesc("Master switch. Off by default on every new device.").addToggle(
      (t) => t.setValue(s.enabledOnThisDevice).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ enabledOnThisDevice: v });
          this.refreshTab();
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Termux integration").setDesc("Allow this plugin to queue requests for the Termux runner.").addToggle(
      (t) => t.setValue(s.termuxIntegrationEnabled).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ termuxIntegrationEnabled: v });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Pairing token").setDesc(
      "Paste the token printed by the Termux installer. It authenticates requests between this plugin and the runner. Stored locally; never logged."
    ).addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder("token from installer").setValue(s.authToken).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ authToken: v.trim() });
        })();
      });
    });
    new import_obsidian4.Setting(containerEl).setName("Profile for this vault").setDesc(
      s.profileId ? `Termux serves this vault as ${s.profileId}. Every vault on the device has its own profile and its own token; one runner drains them all.` : "This vault has no Termux profile yet. Pairing asks the runner for one; it generates the token in Termux and answers with it."
    ).addButton(
      (b) => b.setButtonText(s.profileId ? "Pair again" : "Pair this vault").onClick(() => void this.plugin.cmdPairThisVault())
    );
    new import_obsidian4.Setting(containerEl).setName("Repository for this vault").setDesc(
      "Create a repository here, clone an existing one into this vault, or change the remote. Everything that needs a password stays in Termux; this only does the parts that carry no secret."
    ).addButton(
      (b) => b.setButtonText("Set up repository").onClick(() => void this.plugin.cmdSetupRepository())
    );
    this.renderPreviousReposSetting(containerEl);
    new import_obsidian4.Setting(containerEl).setName("Repository path (informational)").setDesc("The repo path as seen from Termux, e.g. /storage/emulated/0/Documents/Vault. The runner config is authoritative.").addText(
      (t) => t.setValue(s.repoPathHint).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ repoPathHint: v.trim() });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Repository rules").setHeading();
    containerEl.createEl("p", {
      cls: "ngb-settings-note",
      text: "Sparse exclusions, .gitignore and .git/info/exclude, managed per item. Each section is collapsed because these lists can get long."
    });
    this.renderProtectedPathsSection(containerEl, s);
    this.renderSparseSection(containerEl);
    this.renderGitignoreSection(containerEl);
    this.renderExcludeSection(containerEl);
    new import_obsidian4.Setting(containerEl).setName("File context menu").setHeading();
    containerEl.createEl("p", {
      cls: "ngb-settings-note",
      text: "Which Git entries appear on right click / long tap of a file or folder. Stage/Unstage is always shown while the bridge is enabled."
    });
    new import_obsidian4.Setting(containerEl).setName("Show .gitignore commands").setDesc("Add to / remove from .gitignore (shared, synced through git).").addToggle(
      (t) => t.setValue(s.menuGitignore).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ menuGitignore: v });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Show sparse commands").setDesc("Hide on this device / show again (sparse checkout exclusions).").addToggle(
      (t) => t.setValue(s.menuSparse).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ menuSparse: v });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Show .git exclude commands").setDesc("Add to / remove from .git/info/exclude (this clone only, never synced).").addToggle(
      (t) => t.setValue(s.menuExclude).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ menuExclude: v });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Notifications").setHeading();
    new import_obsidian4.Setting(containerEl).setName("Show a result window on success").setDesc(
      "Off: successful operations only update the status panel (and the log). Failures, conflicts and safety blocks are always shown as a window."
    ).addToggle(
      (t) => t.setValue(s.showSuccessModals).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ showSuccessModals: v });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Short messages").setDesc(
      "Where brief informational messages go. Note: a plugin cannot raise native Android toasts, so the choices are Obsidian's own notice, the status panel, or the log only."
    ).addDropdown(
      (d) => d.addOption("notice", "Obsidian notice (toast)").addOption("status-only", "Status panel only").addOption("log-only", "Operation log only").setValue(s.notificationMode).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({
            notificationMode: v
          });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Wrap long lines in diffs").setDesc(
      "Wrap lines in the diff pane instead of scrolling horizontally. Cosmetic and shared across devices (stored in data.json)."
    ).addToggle(
      (t) => t.setValue(this.plugin.sharedPrefs.wrapDiffLines).onChange((v) => {
        void (async () => {
          await this.plugin.setSharedPref({ wrapDiffLines: v });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Show invisible characters in diffs").setDesc(
      "Render whitespace as glyphs in the diff pane: \xB7 space, \u2192 tab, \u240D CR. Makes leading/trailing whitespace visible. Note: copying from the diff then copies the glyphs, not the original whitespace."
    ).addToggle(
      (t) => t.setValue(this.plugin.sharedPrefs.showInvisibles).onChange((v) => {
        void (async () => {
          await this.plugin.setSharedPref({ showInvisibles: v });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Show raw conflict markers").setDesc(
      "In the conflict pane: show the file's <<<<<<< / ======= / >>>>>>> lines as they really are, with the side labels and Keep buttons on separate rows. Off: the markers stay hidden under those rows."
    ).addToggle(
      (t) => t.setValue(this.plugin.sharedPrefs.showConflictMarkers).onChange((v) => {
        void (async () => {
          await this.plugin.setSharedPref({ showConflictMarkers: v });
        })();
      })
    );
    this.renderColorSection(containerEl);
    new import_obsidian4.Setting(containerEl).setName("Auto-refresh status (seconds)").setDesc(
      "While the status panel is open, run a status this often to pick up outside changes. 0 disables it. Each refresh wakes Termux \u2014 consider battery before choosing a small interval. Device-local."
    ).addText((t) => {
      t.inputEl.inputMode = "numeric";
      t.setPlaceholder("0").setValue(String(s.statusRefreshSeconds)).onChange((v) => {
        void (async () => {
          const n = parseInt(v, 10);
          if (!Number.isFinite(n) || n < 0) return;
          await this.plugin.updateDeviceSettings({ statusRefreshSeconds: n });
          this.plugin.restartStatusPoll();
        })();
      });
    });
    new import_obsidian4.Setting(containerEl).setName("Automatic actions").setHeading();
    new import_obsidian4.Setting(containerEl).setName("Pull when Obsidian opens").addToggle(
      (t) => t.setValue(s.autoPullOnOpen).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ autoPullOnOpen: v });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Sync when Obsidian closes / goes to background").setDesc("Queues a sync request during the close transition; Termux may finish it after Obsidian is gone.").addToggle(
      (t) => t.setValue(s.autoSyncOnClose).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ autoSyncOnClose: v });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Periodic sync while Obsidian is open (minutes, 0 = off)").addText(
      (t) => t.setValue(String(s.periodicSyncMinutes)).onChange((v) => {
        void (async () => {
          const n = Math.max(0, Math.floor(Number(v) || 0));
          await this.plugin.updateDeviceSettings({ periodicSyncMinutes: n });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Minimum interval between automatic syncs (minutes)").addText(
      (t) => t.setValue(String(s.minAutoSyncIntervalMinutes)).onChange((v) => {
        void (async () => {
          const n = Math.max(1, Math.floor(Number(v) || 15));
          await this.plugin.updateDeviceSettings({ minAutoSyncIntervalMinutes: n });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Only sync on Wi-Fi (best effort)").setDesc("Uses the WebView network API when available; skipped silently when the API is missing.").addToggle(
      (t) => t.setValue(s.wifiOnly).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ wifiOnly: v });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Skip automatic sync when battery is low (best effort)").addToggle(
      (t) => t.setValue(s.skipOnLowBattery).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ skipOnLowBattery: v });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Advanced").setHeading();
    new import_obsidian4.Setting(containerEl).setName("Operation log").setDesc(
      "Recent bridge operations (URLs redacted). Lives here since the panel strip slot went to the tree/list toggle; also available as the 'Open operation log' command."
    ).addButton(
      (b) => b.setButtonText("Open").onClick(() => new OperationLogModal(this.app, this.plugin.log).open())
    );
    new import_obsidian4.Setting(containerEl).setName("Operation timeout (seconds)").addText(
      (t) => t.setValue(String(s.opTimeoutSeconds)).onChange((v) => {
        void (async () => {
          const n = Math.min(3600, Math.max(10, Math.floor(Number(v) || DEFAULT_DEVICE_SETTINGS.opTimeoutSeconds)));
          await this.plugin.updateDeviceSettings({ opTimeoutSeconds: n });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Companion intent URI template").setDesc('Advanced. "{id}" is replaced by the request id; change it only if the companion app uses a custom scheme.').addText(
      (t) => t.setValue(s.companionUriTemplate).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ companionUriTemplate: v.trim() });
        })();
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Reset device-local settings").setDesc("Restores all settings on this device to defaults. The vault and repository are not touched.").addButton(
      (b) => b.setButtonText("Reset").setDestructive().onClick(() => {
        new ConfirmModal(
          this.app,
          {
            title: "Reset device-local settings?",
            body: [
              "This resets Native Git Bridge settings on this device only.",
              "The repository, the vault, and other devices are not affected."
            ],
            confirmLabel: "Reset settings",
            danger: true
          },
          async (confirmed) => {
            if (!confirmed) return;
            await this.plugin.resetDeviceSettings();
            this.refreshTab();
          }
        ).open();
      })
    );
  }
  /**
   * Re-render the whole tab. `update()` is the 1.13+ entry point; `display()`
   * remains as the fallback for older builds (and is what this tab implements).
   */
  refreshTab() {
    const anyThis = this;
    if (typeof anyThis.update === "function") anyThis.update();
    else this.display();
  }
  /** Collapsible <details> block with a title; open state survives re-renders. */
  detailsSection(containerEl, title, hint) {
    const det = containerEl.createEl("details", { cls: "ngb-details" });
    if (this.openSections.has(title)) det.setAttribute("open", "");
    det.addEventListener("toggle", () => {
      if (det.hasAttribute("open")) this.openSections.add(title);
      else this.openSections.delete(title);
    });
    const sum = det.createEl("summary");
    sum.createSpan({ text: title });
    const hintEl = sum.createSpan({ cls: "ngb-details-hint", text: hint });
    return { body: det.createDiv({ cls: "ngb-details-body" }), hintEl };
  }
  /** One removable row: monospace text + a Remove button. */
  entryRow(listEl, text, onRemove) {
    const row = listEl.createDiv({ cls: "ngb-entry-row" });
    row.createSpan({ cls: "ngb-entry-text", text });
    if (onRemove) {
      const btn = row.createEl("button", { text: "Remove" });
      btn.addEventListener("click", onRemove);
    }
  }
  /** Input + Add button; `onAdd` receives the trimmed value. */
  addRow(body, placeholder, label2, onAdd) {
    const row = body.createDiv({ cls: "ngb-add-row" });
    const input = row.createEl("input", { type: "text", placeholder });
    const btn = row.createEl("button", { text: label2 });
    btn.addEventListener("click", () => {
      const v = input.value.trim();
      if (v !== "") onAdd(v);
      input.value = "";
    });
  }
  // Every section refreshes ONLY its own list in place. Re-rendering the whole
  // tab (display()) on each add/remove resets the scroll position and makes
  // the collapsibles flicker — the view visibly "jumps".
  /**
   * Colours for the diff and conflict panes.
   *
   * One toggle guards the whole thing: while it is off the panes use the
   * theme's own values and there is nothing to configure, so nothing is shown.
   * Switching it on reveals the pickers — light and dark separately, because
   * one set of hex values cannot be legible in both.
   */
  /**
   * Only shown when there is something to show: a repository set aside by a
   * re-clone. It is invisible otherwise, and a permanent empty row would just
   * be a question nobody has.
   */
  renderPreviousReposSetting(containerEl) {
    const setting = new import_obsidian4.Setting(containerEl).setName("Previous repository copies").setDesc("Checking\u2026");
    setting.settingEl.hide();
    void (async () => {
      const repos = await this.plugin.listPreviousRepos();
      if (repos.length === 0) return;
      const total = repos.reduce((n, r) => n + r.sizeKb, 0);
      setting.setDesc(
        `${repos.length === 1 ? "One earlier repository was" : `${repos.length} earlier repositories were`} set aside by a re-clone and still use ${formatSize(total)}. Their history is intact; deleting is final.`
      );
      setting.addButton(
        (b) => b.setButtonText("Review").onClick(() => this.plugin.showPreviousRepoModal(repos, "Previous repository copies"))
      );
      setting.settingEl.show();
    })();
  }
  renderColorSection(containerEl) {
    new import_obsidian4.Setting(containerEl).setName("Custom colours in the diff and conflict panes").setDesc(
      "Off: the panes follow your theme. On: the colours below are used. Cosmetic and shared across devices (stored in data.json)."
    ).addToggle(
      (t) => t.setValue(this.plugin.sharedPrefs.customColors).onChange((v) => {
        void (async () => {
          await this.plugin.setSharedPref({ customColors: v });
          this.refreshTab();
        })();
      })
    );
    if (!this.plugin.sharedPrefs.customColors) return;
    const fields = [
      { key: "diffAddBg", name: "Added line background", desc: "Diff pane" },
      { key: "diffAddHl", name: "Added characters", desc: "Diff pane, intra-line highlight" },
      { key: "diffDelBg", name: "Deleted line background", desc: "Diff pane" },
      { key: "diffDelHl", name: "Deleted characters", desc: "Diff pane, intra-line highlight" },
      { key: "conflictLocalBg", name: "LOCAL side background", desc: "Conflict pane (yours)" },
      { key: "conflictRemoteBg", name: "REMOTE side background", desc: "Conflict pane (theirs)" }
    ];
    for (const mode of ["dark", "light"]) {
      const { body } = this.detailsSection(
        containerEl,
        mode === "dark" ? "Colours (dark theme)" : "Colours (light theme)",
        ""
      );
      const prefKey = mode === "dark" ? "colorsDark" : "colorsLight";
      for (const f of fields) {
        new import_obsidian4.Setting(body).setName(f.name).setDesc(f.desc).addColorPicker(
          (cp) => cp.setValue(this.plugin.sharedPrefs[prefKey][f.key]).onChange((v) => {
            void (async () => {
              await this.plugin.setSharedPref({
                [prefKey]: { ...this.plugin.sharedPrefs[prefKey], [f.key]: v }
              });
            })();
          })
        );
      }
      new import_obsidian4.Setting(body).setName("Reset to the defaults").setDesc("Restores the values this plugin ships with for this theme.").addButton(
        (b) => b.setButtonText("Reset").onClick(() => {
          void (async () => {
            await this.plugin.setSharedPref({ [prefKey]: { ...DEFAULT_COLORS[mode] } });
            this.refreshTab();
          })();
        })
      );
    }
  }
  renderProtectedPathsSection(containerEl, s) {
    const { body, hintEl } = this.detailsSection(containerEl, "Protected paths", "");
    new import_obsidian4.Setting(body).setName("Auto-protect sparse exclusions").setDesc("Paths hidden by the repository's own sparse rules join the protected set automatically (read from git on every status).").addToggle(
      (t) => t.setValue(s.autoProtectSparse).onChange((v) => {
        void (async () => {
          await this.plugin.updateDeviceSettings({ autoProtectSparse: v });
          refresh();
        })();
      })
    );
    const derivedNote = body.createEl("p", { cls: "ngb-settings-note" });
    const list = body.createDiv();
    const invalidNote = body.createDiv({ cls: "ngb-invalid" });
    const refresh = () => {
      const cur = this.plugin.deviceSettings;
      hintEl.setText(`${this.plugin.effectiveProtectedPaths().length} effective`);
      derivedNote.setText(
        !cur.autoProtectSparse ? "Auto-protect is off: only the manual paths below are protected." : cur.derivedProtectedPaths.length ? `Derived from sparse checkout: ${cur.derivedProtectedPaths.join(", ")}` : "Derived from sparse checkout: none yet (run Status once to read them from git)."
      );
      list.empty();
      for (const p of cur.protectedPaths) {
        this.entryRow(list, p, async () => {
          await this.plugin.updateDeviceSettings({
            protectedPaths: this.plugin.deviceSettings.protectedPaths.filter((x) => x !== p)
          });
          refresh();
        });
      }
    };
    refresh();
    this.addRow(body, "Folder/Subfolder", "Add manual path", async (v) => {
      const res = validateProtectedPaths([...this.plugin.deviceSettings.protectedPaths, v]);
      if (!res.ok) {
        invalidNote.setText(`Rejected "${res.offending}": ${res.reason}`);
        return;
      }
      invalidNote.setText("");
      await this.plugin.updateDeviceSettings({ protectedPaths: res.normalized });
      refresh();
    });
  }
  renderSparseSection(containerEl) {
    const { body, hintEl } = this.detailsSection(containerEl, "Sparse checkout exclusions", "");
    body.createEl("p", {
      cls: "ngb-settings-note",
      text: "Paths hidden from THIS device's working tree (non-cone sparse checkout, applied by git in Termux). Hiding never deletes anything from the repository; removing an exclusion materializes the files again."
    });
    const stateNote = body.createDiv({ cls: "ngb-invalid" });
    const list = body.createDiv();
    const refresh = () => {
      const sparse = this.plugin.lastKnownSparse();
      const excls = this.plugin.deviceSettings.derivedProtectedPaths;
      hintEl.setText(sparse ? `${excls.length} hidden` : "run Status to load");
      stateNote.setText(sparse && sparse.enabled === false ? "Sparse checkout is not enabled in this repository." : "");
      list.empty();
      for (const p of excls) {
        this.entryRow(list, p, () => void this.plugin.cmdSparseExclude(p, false).then(refresh));
      }
    };
    refresh();
    this.addRow(
      body,
      "Folder/Subfolder",
      "Hide path",
      (v) => void this.plugin.cmdSparseExclude(v, true).then(refresh)
    );
  }
  renderGitignoreSection(containerEl) {
    const { body, hintEl } = this.detailsSection(containerEl, ".gitignore", "shared, synced through git");
    body.createEl("p", {
      cls: "ngb-settings-note",
      text: ".gitignore is a tracked file: entries apply to ALL devices once the change is committed and synced."
    });
    const list = body.createDiv();
    const refresh = () => {
      void this.plugin.loadGitignore().then((entries) => {
        hintEl.setText(`${entries.length} entries \xB7 shared, synced through git`);
        list.empty();
        for (const e of entries) {
          this.entryRow(list, e, () => void this.plugin.gitignoreRemove(e).then(refresh));
        }
      });
    };
    refresh();
    this.addRow(
      body,
      "pattern, e.g. /Scratch/ or *.tmp",
      "Add entry",
      (v) => void this.plugin.gitignoreAdd(v).then(refresh)
    );
  }
  renderExcludeSection(containerEl) {
    const { body, hintEl } = this.detailsSection(containerEl, ".git/info/exclude", "this clone only, never synced");
    body.createEl("p", {
      cls: "ngb-settings-note",
      text: "Local ignore rules stored inside .git \u2014 they never reach the remote or other devices. Managed through the Termux runner; press Load to read the current file."
    });
    const list = body.createDiv();
    const refresh = () => {
      const entries = this.plugin.currentExcludeLines();
      hintEl.setText(`${entries.length} entries \xB7 this clone only`);
      list.empty();
      for (const e of entries) {
        const path = e.replace(/^\//, "").replace(/\/$/, "");
        this.entryRow(list, e, () => void this.plugin.cmdExcludeChange(path, false).then(refresh));
      }
    };
    refresh();
    new import_obsidian4.Setting(body).addButton(
      (b) => b.setButtonText("Load from Termux").onClick(() => void this.plugin.refreshExcludeList().then(refresh))
    );
    this.addRow(
      body,
      "Folder/Subfolder",
      "Add to exclude",
      (v) => void this.plugin.cmdExcludeChange(v, true).then(refresh)
    );
  }
};

// src/bridge/protocol.ts
function makeRequestId(now, rand) {
  const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `r-${ts}-${rand}`;
}
function randomSuffix(len = 6) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(len);
  const c = typeof activeWindow !== "undefined" ? activeWindow.crypto : void 0;
  if (c?.getRandomValues) c.getRandomValues(arr);
  else for (let i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 256);
  let s = "";
  for (const b of arr) s += alphabet[b % alphabet.length];
  return s;
}
function createRequest(action, args, token, timeoutSeconds, now = /* @__PURE__ */ new Date(), rand = randomSuffix(), profileId = "") {
  const id = makeRequestId(now, rand);
  if (!isValidRequestId(id)) throw new Error(`Generated invalid request id: ${id}`);
  const req = {
    protocolVersion: PROTOCOL_VERSION,
    id,
    token,
    action,
    createdAt: now.toISOString(),
    timeoutSeconds,
    args
  };
  if (isValidProfileId(profileId)) req.profileId = profileId;
  return req;
}
function isValidProfileId(id) {
  return /^p-[0-9a-f]{8,32}$/.test(id);
}
function serializeRequest(req) {
  return JSON.stringify(req, null, 2);
}
function parseResult(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isResultShape(obj)) return null;
  return obj;
}
function isResultShape(o) {
  if (typeof o !== "object" || o === null) return false;
  const r = o;
  return typeof r.protocolVersion === "number" && typeof r.id === "string" && typeof r.action === "string" && typeof r.ok === "boolean" && typeof r.exitCode === "number";
}

// src/bridge/BridgeClient.ts
var CancelToken = class {
  constructor() {
    this.cancelled = false;
  }
  cancel() {
    this.cancelled = true;
  }
};
var BridgeClient = class {
  constructor(fs, paths, opts = {}) {
    this.fs = fs;
    this.paths = paths;
    this.opts = opts;
  }
  now() {
    return this.opts.now ? this.opts.now() : Date.now();
  }
  sleep(ms) {
    if (this.opts.sleep) return this.opts.sleep(ms);
    return new Promise((r) => activeWindow.setTimeout(r, ms));
  }
  async ensureRuntimeDirs() {
    for (const dir of this.paths.all()) {
      if (!await this.fs.exists(dir)) await this.fs.mkdir(dir);
    }
  }
  /** Write the request file. Never composes shell strings; the runner reads JSON. */
  async submit(req) {
    await this.ensureRuntimeDirs();
    await this.fs.write(this.paths.requestFile(req.id), serializeRequest(req));
  }
  /**
   * Poll for the result until timeout or cancellation. Polling happens only
   * while an operation is in flight; nothing runs otherwise.
   */
  async awaitResult(id, timeoutMs, cancel) {
    const deadline = this.now() + timeoutMs;
    const interval = this.opts.pollIntervalMs ?? POLL_INTERVAL_MS;
    const file = this.paths.resultFile(id);
    for (; ; ) {
      if (cancel?.cancelled) return { kind: "cancelled" };
      if (await this.fs.exists(file)) {
        const text = await this.fs.read(file);
        const result = parseResult(text);
        if (result && result.id === id) return { kind: "result", result };
      }
      if (this.now() >= deadline) return { kind: "timeout" };
      await this.sleep(interval);
    }
  }
  /** Signal cancellation: the runner skips not-yet-started requests. */
  async requestCancel(id) {
    await this.ensureRuntimeDirs();
    await this.fs.write(this.paths.cancelFile(id), "");
  }
  /** Remove a consumed result and its cancel flag. */
  async consume(id) {
    for (const f of [this.paths.resultFile(id), this.paths.cancelFile(id)]) {
      try {
        if (await this.fs.exists(f)) await this.fs.remove(f);
      } catch {
      }
    }
  }
  /** How many requests are queued and not processed yet (shown in diagnostics). */
  async pendingRequestCount() {
    if (!await this.fs.exists(this.paths.requestsDir)) return 0;
    return (await this.fs.listFiles(this.paths.requestsDir)).filter((f) => f.endsWith(".json")).length;
  }
  /**
   * Delete files older than the retention window, and orphaned results from a
   * previous session (recovery after Obsidian was killed mid-operation).
   * Age is derived from the timestamp embedded in the request id.
   */
  async cleanupOld() {
    let removed = 0;
    const cutoff = this.now() - RESULT_RETENTION_MS;
    for (const dir of [
      this.paths.requestsDir,
      this.paths.resultsDir,
      this.paths.cancelDir,
      this.paths.doneDir
    ]) {
      let files;
      try {
        files = await this.fs.listFiles(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        const ts = idTimestampMs(basename(f));
        if (ts !== null && ts < cutoff) {
          try {
            await this.fs.remove(f);
            removed++;
          } catch {
          }
        }
      }
    }
    return removed;
  }
  /** Collect results present on disk whose ids we did not consume (crash recovery). */
  async listOrphanResults() {
    if (!await this.fs.exists(this.paths.resultsDir)) return [];
    const out = [];
    for (const f of await this.fs.listFiles(this.paths.resultsDir)) {
      try {
        const r = parseResult(await this.fs.read(f));
        if (r) out.push(r);
      } catch {
      }
    }
    return out;
  }
};
function basename(p) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}
function idTimestampMs(fileName) {
  const m = /^r-(\d{8})T(\d{4,6})Z?/.exec(fileName);
  if (!m) return null;
  const d = m[1];
  const t = (m[2] + "00").slice(0, 6);
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

// src/bridge/runtimePaths.ts
var RuntimePaths = class {
  constructor(configDir) {
    this.root = `${configDir}/plugins/${PLUGIN_ID}/${RUNTIME_DIR_NAME}`;
  }
  get requestsDir() {
    return `${this.root}/${REQUESTS_DIR}`;
  }
  get resultsDir() {
    return `${this.root}/${RESULTS_DIR}`;
  }
  get cancelDir() {
    return `${this.root}/${CANCEL_DIR}`;
  }
  get doneDir() {
    return `${this.root}/${DONE_DIR}`;
  }
  requestFile(id) {
    return `${this.requestsDir}/${id}.json`;
  }
  resultFile(id) {
    return `${this.resultsDir}/${id}.json`;
  }
  cancelFile(id) {
    return `${this.cancelDir}/${id}`;
  }
  all() {
    return [this.root, this.requestsDir, this.resultsDir, this.cancelDir, this.doneDir];
  }
};

// src/bridge/transport.ts
var CompanionIntentTransport = class {
  constructor(uriTemplate, openUri) {
    this.uriTemplate = uriTemplate;
    this.openUri = openUri;
  }
  trigger(requestId) {
    const safeId = encodeURIComponent(requestId);
    this.openUri(this.uriTemplate.replace("{id}", safeId));
    return { kind: "intent" };
  }
};

// src/git/parsers.ts
function unquoteGitPath(raw) {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const inner = raw.slice(1, -1);
  const bytes = [];
  const enc = new TextEncoder();
  let i = 0;
  while (i < inner.length) {
    const c = inner[i];
    if (c !== "\\") {
      for (const b of enc.encode(c)) bytes.push(b);
      i++;
      continue;
    }
    const n = inner[i + 1];
    if (n === void 0) break;
    const simple = {
      a: 7,
      b: 8,
      f: 12,
      n: 10,
      r: 13,
      t: 9,
      v: 11,
      "\\": 92,
      '"': 34
    };
    if (simple[n] !== void 0) {
      bytes.push(simple[n]);
      i += 2;
      continue;
    }
    if (n >= "0" && n <= "7") {
      let oct = "";
      let j = i + 1;
      while (j < inner.length && oct.length < 3) {
        const d = inner[j];
        if (d < "0" || d > "7") break;
        oct += d;
        j++;
      }
      bytes.push(parseInt(oct, 8) & 255);
      i = j;
      continue;
    }
    for (const b of enc.encode(n)) bytes.push(b);
    i += 2;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
}
function parseStatusPorcelainV2(text) {
  const s = {
    ahead: 0,
    behind: 0,
    detached: false,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: []
  };
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "") continue;
    if (line.startsWith("# branch.oid ")) {
      const v = line.slice("# branch.oid ".length);
      if (v !== "(initial)") s.oid = v;
    } else if (line.startsWith("# branch.head ")) {
      const v = line.slice("# branch.head ".length);
      if (v === "(detached)") s.detached = true;
      else s.branch = v;
    } else if (line.startsWith("# branch.upstream ")) {
      s.upstream = line.slice("# branch.upstream ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        s.ahead = parseInt(m[1], 10);
        s.behind = parseInt(m[2], 10);
      }
    } else if (line.startsWith("1 ")) {
      const parts = splitN(line, " ", 8);
      if (parts.length === 9) {
        const xy = parts[1];
        pushEntry(s, {
          path: unquoteGitPath(parts[8]),
          index: xy[0] ?? ".",
          worktree: xy[1] ?? "."
        });
      }
    } else if (line.startsWith("2 ")) {
      const parts = splitN(line, " ", 9);
      if (parts.length === 10) {
        const xy = parts[1];
        const [p, orig] = parts[9].split("	");
        pushEntry(s, {
          path: unquoteGitPath(p ?? ""),
          origPath: orig !== void 0 ? unquoteGitPath(orig) : void 0,
          index: xy[0] ?? ".",
          worktree: xy[1] ?? "."
        });
      }
    } else if (line.startsWith("u ")) {
      const parts = splitN(line, " ", 10);
      if (parts.length === 11) {
        const xy = parts[1];
        s.conflicted.push({
          path: unquoteGitPath(parts[10]),
          index: xy[0] ?? ".",
          worktree: xy[1] ?? "."
        });
      }
    } else if (line.startsWith("? ")) {
      s.untracked.push(unquoteGitPath(line.slice(2)));
    }
  }
  return s;
}
function groupUntrackedChildren(childrenText, untracked) {
  const dirs = untracked.filter((u) => u.endsWith("/"));
  const out = {};
  if (dirs.length === 0) return out;
  for (const rawLine of childrenText.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "") continue;
    const dir = dirs.find((d) => line.startsWith(d));
    if (dir === void 0) continue;
    if (line === dir) continue;
    (out[dir] ??= []).push(line);
  }
  return out;
}
function pushEntry(s, e) {
  if (e.index !== ".") s.staged.push(e);
  if (e.worktree !== ".") s.unstaged.push(e);
}
function splitN(line, sep, n) {
  const out = [];
  let rest = line;
  for (let k = 0; k < n; k++) {
    const idx = rest.indexOf(sep);
    if (idx < 0) break;
    out.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  out.push(rest);
  return out;
}
function parseStatusPorcelainV1(text) {
  const entries = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    let rest = line.slice(3);
    let orig;
    if (x === "R" || x === "C") {
      const arrow = rest.indexOf(" -> ");
      if (arrow >= 0) {
        orig = unquoteGitPath(rest.slice(0, arrow));
        rest = rest.slice(arrow + 4);
      }
    }
    entries.push({
      path: unquoteGitPath(rest),
      origPath: orig,
      index: x === " " ? "." : x,
      worktree: y === " " ? "." : y
    });
  }
  return entries;
}
function parseNameStatus(text) {
  const entries = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "") continue;
    const parts = line.split("	");
    const code = parts[0] ?? "";
    const kind = code[0] ?? "?";
    if ((kind === "R" || kind === "C") && parts.length >= 3) {
      entries.push({
        path: unquoteGitPath(parts[2]),
        origPath: unquoteGitPath(parts[1]),
        index: kind,
        worktree: "."
      });
    } else if (parts.length >= 2) {
      entries.push({ path: unquoteGitPath(parts[1]), index: kind, worktree: "." });
    }
  }
  return entries;
}
function countSkipWorktree(text) {
  let n = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("S ")) n++;
  }
  return n;
}
function sparseExclusionPaths(patterns) {
  const out = [];
  for (const raw of patterns) {
    let p = raw.trim();
    if (!p.startsWith("!")) continue;
    p = p.slice(1).trim();
    if (p.startsWith("/")) p = p.slice(1);
    p = p.replace(/\/+$/, "");
    if (p === "" || /[*?[\]]/.test(p)) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}
function parseSparseState(fields) {
  const enabled = fields.sparseEnabled.trim() === "true";
  const coneRaw = fields.sparseCone.trim();
  return {
    enabled,
    coneMode: coneRaw === "" ? void 0 : coneRaw === "true",
    patterns: fields.sparseList.split("\n").map((l) => l.trim()).filter((l) => l !== ""),
    skipWorktreeCount: resolveSkipCount(fields.skipWorktreeCount, fields.lsFilesV)
  };
}
function resolveSkipCount(count, lsFilesV) {
  if (count !== void 0 && count.trim() !== "") {
    const n = parseInt(count.trim(), 10);
    if (!Number.isNaN(n)) return n;
  }
  return countSkipWorktree(lsFilesV ?? "");
}
function parseLastCommit(text) {
  const line = text.split("\n")[0]?.trim();
  if (!line) return void 0;
  const [hash, date, ...subj] = line.split("	");
  if (!hash || !/^[0-9a-f]{7,40}$/i.test(hash)) return void 0;
  return { hash, date: date ?? "", subject: subj.join("	") };
}

// src/git/sparseSafety.ts
var STATUS_LABEL = {
  D: "deleted",
  M: "modified",
  A: "added",
  R: "renamed",
  C: "copied",
  T: "type-changed",
  U: "unmerged",
  "?": "untracked"
};
function label(code) {
  return STATUS_LABEL[code] ?? `changed (${code})`;
}
function evaluateSparseSafety(statusProtectedRaw, stagedProtectedRaw, protectedPaths, now = /* @__PURE__ */ new Date()) {
  const violations = [];
  for (const e of parseStatusPorcelainV1(statusProtectedRaw)) {
    const code = e.index !== "." ? e.index : e.worktree;
    violations.push({ path: e.path, status: label(code), source: "worktree" });
  }
  for (const e of parseNameStatus(stagedProtectedRaw)) {
    violations.push({ path: e.path, status: label(e.index), source: "staged" });
  }
  return {
    safe: violations.length === 0,
    violations,
    protectedPaths: [...protectedPaths],
    checkedAt: now.toISOString()
  };
}

// src/ops/OperationLock.ts
var OperationLock = class {
  constructor(onChange) {
    this.onChange = onChange;
    this.current = null;
  }
  get active() {
    return this.current;
  }
  tryAcquire(id, action, now = Date.now()) {
    if (this.current !== null) return false;
    this.current = { id, action, startedAt: now };
    this.onChange?.(this.current);
    return true;
  }
  release(id) {
    if (this.current === null || this.current.id !== id) return false;
    this.current = null;
    this.onChange?.(null);
    return true;
  }
  /** Force-clear a stale lock (e.g. restored marker older than the threshold). */
  clearStale(now = Date.now(), maxAgeMs = STALE_LOCK_MS) {
    if (this.current !== null && now - this.current.startedAt > maxAgeMs) {
      this.current = null;
      this.onChange?.(null);
      return true;
    }
    return false;
  }
  /** Restore a persisted marker after restart (before reconciliation). */
  restore(marker) {
    this.current = marker;
  }
};
function isMarkerStale(marker, now = Date.now(), maxAgeMs = STALE_LOCK_MS) {
  return now - marker.startedAt > maxAgeMs;
}

// src/ops/OperationLog.ts
var _OperationLog = class _OperationLog {
  constructor(store) {
    this.store = store;
    this.entries = [];
    const raw = store.getValue(_OperationLog.KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.entries = parsed.slice(-LOG_MAX_ENTRIES);
        }
      } catch {
      }
    }
  }
  add(level, action, message, detail) {
    this.entries.push({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      action,
      message: redact(message),
      detail: detail !== void 0 ? redact(truncate(detail, 8 * 1024)) : void 0
    });
    if (this.entries.length > LOG_MAX_ENTRIES) {
      this.entries = this.entries.slice(-LOG_MAX_ENTRIES);
    }
    this.persist();
  }
  list() {
    return this.entries;
  }
  clear() {
    this.entries = [];
    this.persist();
  }
  persist() {
    this.store.setValue(_OperationLog.KEY, JSON.stringify(this.entries));
  }
};
_OperationLog.KEY = "oplog";
var OperationLog = _OperationLog;
function redact(s) {
  return s.replace(/(\w+:\/\/)[^/\s@]+:[^/\s@]+@/g, "$1***@");
}
function truncate(s, max2) {
  return s.length > max2 ? s.slice(0, max2) + `
\u2026 (${s.length - max2} more bytes truncated)` : s;
}

// src/ui/StatusBarController.ts
var STATE_META = {
  disabled: { cls: "ngb-status-clean", label: "git: off" },
  clean: { cls: "ngb-status-clean", label: "git: clean" },
  changed: { cls: "ngb-status-changed", label: "git: changes" },
  syncing: { cls: "ngb-status-syncing", label: "git: working\u2026" },
  conflict: { cls: "ngb-status-conflict", label: "git: conflict" },
  error: { cls: "ngb-status-error", label: "git: error" }
};
var StatusBarController = class {
  constructor(el, onClick) {
    this.el = el;
    this.state = "disabled";
    el.addClass("ngb-status-bar-item");
    el.addEventListener("click", onClick);
    this.set("disabled");
  }
  set(state, detail) {
    const meta = STATE_META[state];
    for (const m of Object.values(STATE_META)) this.el.removeClass(m.cls);
    this.el.addClass(meta.cls);
    this.el.setText(detail ? `${meta.label} ${detail}` : meta.label);
    this.state = state;
  }
  get current() {
    return this.state;
  }
};

// src/ui/DiagnosticsModal.ts
var import_obsidian6 = require("obsidian");
var DiagnosticsModal = class extends import_obsidian6.Modal {
  constructor(app, report) {
    super(app);
    this.report = report;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Native Git Bridge: diagnostics");
    const c = this.contentEl;
    if (this.report.problems.length > 0) {
      const warn = c.createDiv({ cls: "ngb-warning" });
      warn.createEl("strong", { text: "Problems found:" });
      const ul = warn.createEl("ul", { cls: "ngb-file-list" });
      for (const p of this.report.problems) ul.createEl("li", { text: p });
    } else {
      c.createEl("p", { cls: "ngb-ok", text: "No problems detected." });
    }
    const renderKv = (title, data) => {
      const sec = c.createDiv({ cls: "ngb-section" });
      sec.createEl("h3", { text: title });
      const kv = sec.createDiv({ cls: "ngb-kv" });
      for (const [k, v] of Object.entries(data)) {
        kv.createDiv({ cls: "k", text: k });
        kv.createDiv({ cls: "ngb-mono", text: v });
      }
    };
    renderKv("Plugin (this device)", this.report.pluginSide);
    if (this.report.runnerSide) renderKv("Termux runner", this.report.runnerSide);
    else
      c.createEl("p", {
        cls: "ngb-settings-note",
        text: "Runner-side diagnostics unavailable (no response from Termux \u2014 run the GitBridge shortcut or check the integration settings)."
      });
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/ui/gitModals.ts
var import_obsidian7 = require("obsidian");
var CommitMessageModal = class extends import_obsidian7.Modal {
  constructor(app, opts, onDone) {
    super(app);
    this.opts = opts;
    this.onDone = onDone;
    this.resolved = false;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText(this.opts.title);
    const c = this.contentEl;
    const ta = c.createEl("textarea", { cls: "ngb-mono ngb-textarea-full" });
    ta.rows = 3;
    ta.placeholder = this.opts.placeholder;
    ta.value = this.opts.initial ?? "";
    const note = c.createDiv({ cls: "ngb-invalid" });
    const doSubmit = () => {
      const msg = ta.value.trim();
      if (msg.length === 0) {
        note.setText("Commit message must not be empty.");
        return;
      }
      if (msg.length > 1e3) {
        note.setText("Commit message is longer than 1000 characters.");
        return;
      }
      this.resolved = true;
      this.close();
      this.onDone(msg);
    };
    placeModalAction(this, {
      label: this.opts.submitLabel,
      icon: "check",
      hasInput: true,
      onClick: doSubmit
    });
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") doSubmit();
    });
    window.setTimeout(() => ta.focus(), 10);
  }
  onClose() {
    if (!this.resolved) this.onDone(null);
    this.contentEl.empty();
  }
};
var ConflictModal = class extends import_obsidian7.Modal {
  constructor(app, conflicts, actions) {
    super(app);
    this.conflicts = conflicts;
    this.actions = actions;
  }
  onOpen() {
    this.modalEl.addClass("ngb-modal");
    this.titleEl.setText("Merge conflicts \u2014 sync stopped");
    const c = this.contentEl;
    c.createDiv({
      cls: "ngb-warning",
      text: "Pulling produced merge conflicts. Nothing was pushed. Resolve the conflict markers in the files below (then run Sync again), or abort the merge to return to the previous state."
    });
    const ul = c.createEl("ul", { cls: "ngb-file-list" });
    for (const f of this.conflicts) {
      const li = ul.createEl("li");
      li.createSpan({ cls: "ngb-badge", text: "U" });
      const link = li.createEl("a", { text: f });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.close();
        this.actions.openFile(f);
      });
    }
    const btns = c.createDiv({ cls: "ngb-buttons" });
    const abort = btns.createEl("button", { text: "Abort merge\u2026", cls: "mod-warning" });
    abort.addEventListener("click", () => {
      this.close();
      this.actions.abortMerge();
    });
    const close = btns.createEl("button", { text: "Close", cls: "mod-cta" });
    close.addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/settings/pairing.ts
var TOKEN_RE = /^[A-Za-z0-9]{16,128}$/;
var PROFILE_RE = /^p-[0-9a-f]{8,32}$/;
function parsePairingFile(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const r = obj;
  if (typeof r.token !== "string" || !TOKEN_RE.test(r.token)) return null;
  const out = { token: r.token };
  if (typeof r.repoPath === "string" && r.repoPath.length < 4096) out.repoPath = r.repoPath;
  if (typeof r.profileId === "string" && PROFILE_RE.test(r.profileId)) out.profileId = r.profileId;
  if (typeof r.createdAt === "string") out.createdAt = r.createdAt;
  return out;
}

// src/git/historyParsers.ts
function describeFileChange(e) {
  const counts = e.added !== void 0 && e.deleted !== void 0 ? `+${e.added} \u2212${e.deleted}` : "";
  switch (e.code) {
    case "A":
      return counts === "" ? "added" : `added, ${counts}`;
    case "D":
      return "deleted";
    case "R":
      return e.origPath ? `renamed from ${e.origPath}` : "renamed";
    case "C":
      return e.origPath ? `copied from ${e.origPath}` : "copied";
    case "T":
      return "type changed";
    case "M":
    default:
      return counts === "" ? e.code ? `changed (${e.code})` : "changed" : counts;
  }
}
var RS = String.fromCharCode(30);
var FS = String.fromCharCode(31);
function parseFileLog(raw, currentPath) {
  const out = [];
  let lastKnownPath = currentPath;
  for (const record of raw.split(RS)) {
    if (record.trim() === "") continue;
    const lines = record.split("\n");
    const header = lines[0] ?? "";
    const [hash, date, author, ...subj] = header.split(FS);
    if (!hash || !/^[0-9a-f]{7,40}$/i.test(hash)) continue;
    let pathAtCommit;
    let code;
    let origPath;
    let added;
    let deleted;
    for (const rawLine of lines.slice(1)) {
      const line = rawLine.replace(/\r$/, "");
      if (line.trim() === "") continue;
      const parts = line.split("	");
      if (line.startsWith(":")) {
        const status = (parts[0] ?? "").split(" ").pop() ?? "";
        code = status[0];
        if ((code === "R" || code === "C") && parts.length >= 3) {
          origPath = unquoteGitPath(parts[1]);
          pathAtCommit = unquoteGitPath(parts[2]);
        } else if (parts.length >= 2) {
          pathAtCommit = unquoteGitPath(parts[1]);
        }
        continue;
      }
      if (/^(\d+|-)\t(\d+|-)\t/.test(line)) {
        const a = parts[0] ?? "";
        const d = parts[1] ?? "";
        if (a !== "-" && d !== "-") {
          added = Number(a);
          deleted = Number(d);
        }
        if (pathAtCommit === void 0 && parts.length >= 3) {
          const p = parts[2];
          const arrow = p.indexOf(" => ");
          pathAtCommit = unquoteGitPath(arrow >= 0 ? p.slice(arrow + 4) : p);
        }
        continue;
      }
      if (code === void 0) {
        const c = parts[0] ?? "";
        code = c[0];
        if ((c.startsWith("R") || c.startsWith("C")) && parts.length >= 3) {
          origPath = unquoteGitPath(parts[1]);
          pathAtCommit = unquoteGitPath(parts[2]);
        } else if (parts.length >= 2) {
          pathAtCommit = unquoteGitPath(parts[1]);
        }
      }
    }
    if (pathAtCommit === void 0) pathAtCommit = lastKnownPath;
    lastKnownPath = pathAtCommit;
    out.push({
      hash,
      date: date ?? "",
      author: author ?? "",
      subject: (subj ?? []).join(FS),
      pathAtCommit,
      code,
      origPath,
      added,
      deleted
    });
  }
  return out;
}
function parseRepoLog(raw) {
  const out = [];
  for (const record of raw.split(RS)) {
    if (record.trim() === "") continue;
    const lines = record.split("\n");
    const header = lines[0] ?? "";
    const [hash, date, author, ...subj] = header.split(FS);
    if (!hash || !/^[0-9a-f]{7,40}$/i.test(hash)) continue;
    const files = [];
    for (const rawLine of lines.slice(1)) {
      const line = rawLine.replace(/\r$/, "");
      if (line.trim() === "") continue;
      const parts = line.split("	");
      const code = parts[0] ?? "";
      if ((code.startsWith("R") || code.startsWith("C")) && parts.length >= 3) {
        files.push({
          code: code[0],
          path: unquoteGitPath(parts[2]),
          origPath: unquoteGitPath(parts[1])
        });
      } else if (parts.length >= 2 && code !== "") {
        files.push({ code: code[0], path: unquoteGitPath(parts[1]) });
      }
    }
    out.push({
      hash,
      date: date ?? "",
      author: author ?? "",
      subject: (subj ?? []).join(FS),
      files
    });
  }
  return out;
}
function decodeBase64ToBytes(b64) {
  const bin = atob(b64.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToTextIfNotBinary(bytes) {
  const probe = bytes.subarray(0, Math.min(bytes.length, 8e3));
  for (const b of probe) if (b === 0) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// src/ui/StatusView.ts
var import_obsidian10 = require("obsidian");

// src/ui/pathTree.ts
function compressChains(nodes) {
  return nodes.map((n) => {
    let node = n;
    while (node.items.length === 0 && node.children.length === 1) {
      const only = node.children[0];
      node = { ...only, name: `${node.name}/${only.name}` };
    }
    return { ...node, children: compressChains(node.children) };
  });
}
function buildPathTree(items, getPath) {
  const top = /* @__PURE__ */ new Map();
  const rootItems = [];
  const nodeFor = (segments) => {
    let map = top;
    let node;
    let path = "";
    for (const seg of segments) {
      path = path === "" ? seg : `${path}/${seg}`;
      let next = map.get(seg);
      if (!next) {
        next = { name: seg, path, children: /* @__PURE__ */ new Map(), items: [] };
        map.set(seg, next);
      }
      node = next;
      map = next.children;
    }
    return node;
  };
  for (const it of items) {
    const raw = getPath(it);
    const p = raw.endsWith("/") ? raw.slice(0, -1) : raw;
    const segs = p.split("/");
    if (segs.length <= 1) {
      rootItems.push(it);
      continue;
    }
    nodeFor(segs.slice(0, -1)).items.push(it);
  }
  const freeze = (n) => {
    const children = [...n.children.values()].map(freeze).sort((a, b) => a.name.localeCompare(b.name));
    const count = n.items.length + children.reduce((s, c) => s + c.count, 0);
    return { name: n.name, path: n.path, children, items: n.items, count };
  };
  return {
    rootItems,
    folders: compressChains(
      [...top.values()].map(freeze).sort((a, b) => a.name.localeCompare(b.name))
    )
  };
}

// src/ui/countBadge.ts
function formatCount(count) {
  const n = Math.max(0, Math.floor(count));
  if (n > 9999) return { text: "9999+", small: true, clamped: true };
  return { text: String(n), small: n > 99, clamped: n > 99 };
}
function renderCountBadge(parent, count, describe) {
  const fmt = formatCount(count);
  const el = parent.createSpan({
    cls: `ngb-sv-count${fmt.small ? " ngb-sv-count-sm" : ""}`,
    text: fmt.text
  });
  el.setAttribute("aria-label", describe(count));
  if (!fmt.clamped) return el;
  el.addClass("ngb-sv-count-more");
  let pop = null;
  let timer = null;
  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  const hide = () => {
    clearTimer();
    pop?.remove();
    pop = null;
  };
  const show = () => {
    clearTimer();
    if (pop === null) {
      pop = el.doc.body.createDiv({ cls: "ngb-count-pop", text: describe(count) });
      const r = el.getBoundingClientRect();
      pop.style.top = `${Math.max(4, r.top - 4)}px`;
      pop.style.right = `${Math.max(4, el.win.innerWidth - r.right)}px`;
    }
  };
  const arm = () => {
    clearTimer();
    timer = el.win.setTimeout(hide, 3e3);
  };
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    show();
    arm();
  });
  el.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    show();
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
    el.addEventListener(ev, () => {
      if (pop !== null) arm();
    });
  }
  return el;
}

// src/ui/icons.ts
var import_obsidian8 = require("obsidian");
var NGB_ICON_PUSH = "ngb-push";
var NGB_ICON_PULL = "ngb-pull";
var NGB_ICON_FETCH = "ngb-fetch";
var NGB_ICON_STAGE_ALL = "ngb-stage-all";
var NGB_ICON_UNSTAGE_ALL = "ngb-unstage-all";
var NGB_ICON_SYNC = "ngb-sync";
var SCALE = 100 / 24;
function scaled(path, strokeWidth = 2) {
  return `<g transform="scale(${SCALE})" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${path}</g>`;
}
var CLOUD = "M17.5 15a4.5 4.5 0 0 0-.9-8.9A6 6 0 0 0 5.2 8.4A3.8 3.8 0 0 0 6 15";
function registerIcons() {
  (0, import_obsidian8.addIcon)(NGB_ICON_PULL, scaled(`<path d="${CLOUD}"/><path d="M12 11v8M8.5 15.5 12 19l3.5-3.5"/>`));
  (0, import_obsidian8.addIcon)(NGB_ICON_PUSH, scaled(`<path d="${CLOUD}"/><path d="M12 19v-8M8.5 14.5 12 11l3.5 3.5"/>`));
  (0, import_obsidian8.addIcon)(
    NGB_ICON_FETCH,
    scaled(
      `<path d="${CLOUD}"/><path d="M10.4 13.2a1.8 1.8 0 0 1 3.5.6c0 1.2-1.8 1.8-1.8 3"/><path d="M12.1 19.6h.01"/>`
    )
  );
  (0, import_obsidian8.addIcon)(
    NGB_ICON_STAGE_ALL,
    scaled('<path d="M4 6h9M4 11h9M4 16h5M17 10v8M13 14h8"/>')
  );
  (0, import_obsidian8.addIcon)(
    NGB_ICON_UNSTAGE_ALL,
    scaled('<path d="M4 6h9M4 11h9M4 16h5M13 14h8"/>')
  );
  (0, import_obsidian8.addIcon)(
    NGB_ICON_SYNC,
    scaled('<path d="M8 3v14M4 13l4 4 4-4M16 21V7M12 11l4-4 4 4"/>')
  );
}

// src/ui/animatedIcons.ts
var import_obsidian9 = require("obsidian");
function applySweepIcon(button, iconName, direction) {
  button.empty();
  const wrap = button.createSpan({ cls: "ngb-sweep" });
  const base = wrap.createSpan({ cls: "ngb-sweep-base" });
  (0, import_obsidian9.setIcon)(base, iconName);
  const lit = wrap.createSpan({ cls: `ngb-sweep-lit ngb-sweep-${direction}` });
  (0, import_obsidian9.setIcon)(lit, iconName);
}

// src/ui/StatusView.ts
var NGB_STATUS_VIEW = "native-git-bridge-status";
function actionSlots(scope, group, hasItems = true) {
  const none = { icon: null };
  if (!hasItems) return [none, none, none];
  const where = scope === "group" ? "" : " in this folder";
  switch (group) {
    case "staged":
      return [
        none,
        { icon: "minus", tooltip: `Unstage everything staged${where || ""}`, action: "unstage" },
        none
        // files offer discard here; staged content does not
      ];
    case "unstaged":
      return [
        none,
        { icon: "plus", tooltip: `Stage the changed (tracked) files${where}`, action: "stage" },
        { icon: "undo-2", tooltip: `Discard the changes${where}`, action: "discard", warn: true }
      ];
    case "untracked":
      return [
        none,
        { icon: "plus", tooltip: `Stage the new files${where}`, action: "stage" },
        // Trashing every new file in the whole group in one tap is deliberately
        // not offered; on a folder it is, because the blast radius is visible.
        scope === "folder" ? { icon: "trash", tooltip: "Move the new files in this folder to Obsidian's trash", action: "discard", warn: true } : none
      ];
    default:
      return [none, none, none];
  }
}
var CHANGE_LABEL = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type changed",
  U: "conflicted",
  "?": "untracked"
};
var StatusView = class extends import_obsidian10.ItemView {
  constructor(leaf, actions) {
    super(leaf);
    this.actions = actions;
    this.data = null;
    this.progressEl = null;
    this.cancelBtn = null;
    this.collapsed = {
      conflicted: false,
      staged: false,
      unstaged: false,
      untracked: true
    };
    /**
     * Untracked folder rows the user collapsed. Folders start EXPANDED: the
     * whole point of listing their children is that a freshly created folder
     * must show the notes inside it as actionable rows.
     */
    this.collapsedDirs = /* @__PURE__ */ new Set();
  }
  getViewType() {
    return NGB_STATUS_VIEW;
  }
  getDisplayText() {
    return "Native Git";
  }
  getIcon() {
    return "git-branch";
  }
  setData(data) {
    this.data = data;
    this.render();
  }
  /**
   * Update only the elapsed-time text. A full re-render would recreate the
   * toolbar buttons every tick and restart their CSS animations from the first
   * frame, which made the activity animation look erratic.
   */
  updateProgressText(text) {
    if (this.data) this.data.progress = text ?? void 0;
    if (this.progressEl && this.cancelBtn) {
      this.applyStripState(text, this.data?.activeOperation ?? null);
      return;
    }
    this.render();
  }
  /** Toggle the reserved cancel slot and the label without rebuilding the row. */
  applyStripState(progress, activeOperation) {
    const running = progress !== null && progress !== "";
    if (this.cancelBtn) {
      this.cancelBtn.toggleClass("ngb-slot-inactive", !running);
      this.cancelBtn.setAttribute("aria-disabled", running ? "false" : "true");
    }
    if (this.progressEl) {
      this.progressEl.toggleClass("ngb-sv-progress-idle", !running);
      this.progressEl.setText(
        running ? progress : activeOperation ? `${activeOperation} pending\u2026` : "Idle"
      );
    }
  }
  async onOpen() {
    this.render();
  }
  onPaneMenu(menu) {
    menu.addItem(
      (item) => item.setTitle("Native Git: operation log").setIcon("file-clock").onClick(() => this.actions.openLog())
    );
    menu.addItem(
      (item) => item.setTitle("Refresh status").setIcon("refresh-cw").onClick(() => this.actions.refresh())
    );
  }
  render() {
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-status-view");
    const d = this.data;
    const bar = c.createDiv({ cls: "ngb-sv-toolbar" });
    const running = d?.runningAction;
    const iconBtn = (icon, tooltip, cb, actionName, anim = "pulse") => {
      const b = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
      b.setAttribute("aria-label", tooltip);
      const active = Boolean(actionName) && running === actionName;
      if (active && (anim === "sweep-down" || anim === "sweep-up")) {
        applySweepIcon(b, icon, anim === "sweep-down" ? "down" : "up");
        b.addClass("ngb-sv-icon-active");
      } else {
        (0, import_obsidian10.setIcon)(b, icon);
        if (active) {
          b.addClass(`ngb-anim-${anim}`);
          b.addClass("ngb-sv-icon-active");
        }
      }
      b.addEventListener("click", cb);
    };
    iconBtn(NGB_ICON_SYNC, "Sync", this.actions.sync, "sync", "pulse");
    iconBtn("check", "Commit", this.actions.commit, "commit", "pulse");
    iconBtn(NGB_ICON_STAGE_ALL, "Stage all", this.actions.stageAll, "stage-all", "pulse");
    iconBtn(NGB_ICON_UNSTAGE_ALL, "Unstage all", this.actions.unstageAll, "unstage-all", "pulse");
    iconBtn(NGB_ICON_FETCH, "Fetch", this.actions.fetch, "fetch", "sweep-down");
    iconBtn(NGB_ICON_PULL, "Pull", this.actions.pull, "pull", "sweep-down");
    iconBtn(NGB_ICON_PUSH, "Push", this.actions.push, "push", "sweep-up");
    iconBtn("refresh-cw", "Refresh status", this.actions.refresh, "status", "spin");
    const strip = c.createDiv({ cls: "ngb-sv-strip" });
    const stripLeft = strip.createDiv({ cls: "ngb-sv-strip-left" });
    const cancel = stripLeft.createEl("button", {
      cls: "clickable-icon ngb-sv-icon ngb-sv-icon-warn ngb-sv-cancel-slot"
    });
    cancel.setAttribute("aria-label", "Cancel current operation");
    (0, import_obsidian10.setIcon)(cancel, "x");
    cancel.addEventListener("click", () => this.actions.cancel());
    this.cancelBtn = cancel;
    this.progressEl = stripLeft.createSpan({ cls: "ngb-sv-progress-text" });
    this.applyStripState(d?.progress ?? null, d?.activeOperation ?? null);
    const stripRight = strip.createDiv({ cls: "ngb-sv-strip-right" });
    const treeBtn = stripRight.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    const treeOn = d?.treeView === true;
    treeBtn.setAttribute("aria-label", treeOn ? "Tree layout (tap for list)" : "List layout (tap for tree)");
    (0, import_obsidian10.setIcon)(treeBtn, treeOn ? "folder-tree" : "list");
    treeBtn.addEventListener("click", this.actions.toggleTree);
    const histBtn = stripRight.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    histBtn.setAttribute("aria-label", "Repository history");
    (0, import_obsidian10.setIcon)(histBtn, "history");
    histBtn.addEventListener("click", this.actions.openHistory);
    const head = c.createDiv({ cls: "ngb-sv-header" });
    head.createSpan({ cls: `ngb-sv-dot ngb-sv-${d?.state ?? "unknown"}` });
    head.createSpan({ cls: "ngb-sv-state", text: d ? stateLabel(d.state) : "not checked yet" });
    if (d) {
      head.createSpan({
        cls: "ngb-settings-note",
        text: ` ${d.branch ?? "\u2014"} \u2191${d.ahead} \u2193${d.behind}`
      });
    }
    if (!d) {
      c.createEl("p", { cls: "ngb-settings-note", text: "Press refresh to query native Git." });
      return;
    }
    const stageable = d.unstaged.length + d.untracked.length > 0;
    this.renderGroup(c, "conflicted", "Conflicts", d.conflicted.map((e) => entry(e, "U")), true);
    this.renderGroup(
      c,
      "staged",
      "Staged changes",
      d.staged.map((e) => entry(e, e.index)),
      false,
      stageable
    );
    this.renderGroup(c, "unstaged", "Changes", d.unstaged.map((e) => entry(e, e.worktree)), false);
    this.renderGroup(
      c,
      "untracked",
      "Untracked",
      d.untracked.map((p) => ({ path: p, code: "?" })),
      false
    );
    if (d.conflicted.length + d.staged.length + d.unstaged.length + d.untracked.length === 0) {
      c.createEl("p", { cls: "ngb-ok", text: "Working tree clean." });
    }
    const foot = c.createDiv({ cls: "ngb-sv-footer" });
    const kv = foot.createDiv({ cls: "ngb-sv-kv" });
    const row = (k, v) => {
      const line = kv.createDiv({ cls: "ngb-sv-kv-row" });
      line.createSpan({ cls: "ngb-sv-kv-key", text: k });
      line.createSpan({ cls: "ngb-sv-kv-val", text: v });
    };
    if (d.sparse) {
      row("Sparse", d.sparse.enabled ? `on (${d.sparse.patterns.length} rules)` : "off");
      row("Hidden files", String(d.sparse.skipWorktreeCount));
    }
    row("Bridge", d.bridge);
    row("Last sync", d.lastSyncAt ?? "never");
    if (d.fetchedAt) row("Updated", d.fetchedAt);
  }
  renderGroup(parent, group, title, items, danger, showWhenEmpty = false) {
    if (items.length === 0 && !showWhenEmpty) return;
    const wrap = parent.createDiv({ cls: "ngb-sv-group" });
    const header = wrap.createDiv({ cls: "ngb-sv-group-header" });
    const chevron = header.createSpan({ cls: "ngb-sv-chevron" });
    (0, import_obsidian10.setIcon)(chevron, this.collapsed[group] ? "chevron-right" : "chevron-down");
    header.createSpan({
      cls: danger ? "ngb-sv-group-title ngb-status-conflict" : "ngb-sv-group-title",
      text: title
    });
    const gslot = this.slotFactory(header.createDiv({ cls: "ngb-sv-file-actions" }));
    for (const s of actionSlots("group", group, items.length > 0)) {
      gslot(s.icon, s.tooltip, s.action ? () => this.actions.groupAction(group, s.action) : void 0, s.warn);
    }
    renderCountBadge(header, items.length, (n) => `${n} files in ${title.toLowerCase()}`);
    header.addEventListener("click", () => {
      this.collapsed[group] = !this.collapsed[group];
      this.render();
    });
    this.attachContextMenu(header, (pos) => this.actions.groupMenu(group, pos));
    if (this.collapsed[group]) return;
    const list = wrap.createDiv({ cls: "ngb-sv-list" });
    if (items.length === 0) {
      list.createDiv({ cls: "ngb-sv-empty", text: "Nothing staged yet." });
      return;
    }
    if (this.data?.treeView) {
      this.renderTreeItems(list, group, items);
      return;
    }
    for (const it of items) {
      this.renderRow(list, group, it, 0);
      const children = group === "untracked" ? this.data?.untrackedChildren?.[it.path] : void 0;
      if (children && children.length > 0 && !this.collapsedDirs.has(it.path)) {
        for (const c of children) this.renderRow(list, group, { path: c, code: "?" }, 1);
      }
    }
  }
  /**
   * Right click (desktop) and long press (touch) on any row or header. The
   * touch timer backs up `contextmenu`, which Android's WebView delivers
   * inconsistently, and is cancelled by movement so scrolling never opens a
   * menu. The caller receives the anchor position and opens the menu itself.
   */
  attachContextMenu(el, open) {
    const anchor = (ev) => {
      if (ev instanceof MouseEvent && ev.clientX) return { x: ev.clientX, y: ev.clientY };
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.bottom };
    };
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      open(anchor(ev));
    });
    let longPress = null;
    const clearLongPress = () => {
      if (longPress !== null) {
        window.clearTimeout(longPress);
        longPress = null;
      }
    };
    el.addEventListener(
      "touchstart",
      (ev) => {
        clearLongPress();
        longPress = window.setTimeout(() => {
          longPress = null;
          open(anchor(ev));
        }, 500);
      },
      { passive: true }
    );
    for (const e of ["touchend", "touchmove", "touchcancel"]) {
      el.addEventListener(e, clearLongPress, { passive: true });
    }
  }
  /**
   * One action column, used by folder rows AND group headers so both mirror
   * the file rows slot for slot ([open] [stage/unstage] [discard] plus the
   * count column). `null` renders an invisible placeholder that keeps the
   * column width without being focusable or clickable.
   */
  slotFactory(acts) {
    return (icon, tooltip, cb, warn = false) => {
      const b = acts.createEl("button", {
        cls: `clickable-icon ngb-sv-icon${warn ? " ngb-sv-icon-warn" : ""}${icon === null ? " ngb-slot-inactive" : ""}`
      });
      if (icon === null) {
        (0, import_obsidian10.setIcon)(b, "circle");
        b.setAttribute("aria-hidden", "true");
        b.tabIndex = -1;
        return;
      }
      b.setAttribute("aria-label", tooltip ?? "");
      (0, import_obsidian10.setIcon)(b, icon);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        cb?.();
      });
    };
  }
  /** Tree layout: group items nested under collapsible folder rows. */
  renderTreeItems(list, group, items) {
    let expanded = items;
    if (group === "untracked") {
      expanded = [];
      for (const it of items) {
        const children = this.data?.untrackedChildren?.[it.path];
        if (it.path.endsWith("/") && children && children.length > 0) {
          for (const c of children) expanded.push({ path: c, code: "?" });
        } else {
          expanded.push(it);
        }
      }
    }
    const tree = buildPathTree(expanded, (i) => i.path);
    for (const it of tree.rootItems) this.renderRow(list, group, it, 0);
    for (const f of tree.folders) this.renderFolderNode(list, group, f, 0);
  }
  renderFolderNode(list, group, node, depth) {
    const rowEl = list.createDiv({ cls: `ngb-sv-file ngb-ind-${Math.min(depth, 6)}` });
    const key2 = `${group}:${node.path}`;
    const collapsed = this.collapsedDirs.has(key2);
    const main = rowEl.createDiv({ cls: "ngb-sv-file-main" });
    const chev = main.createSpan({ cls: "ngb-sv-chevron ngb-sv-row-chevron" });
    (0, import_obsidian10.setIcon)(chev, collapsed ? "chevron-right" : "chevron-down");
    main.createSpan({ cls: "ngb-sv-file-name ngb-sv-folder-name", text: `${node.name}/` });
    main.addEventListener("click", () => {
      if (collapsed) this.collapsedDirs.delete(key2);
      else this.collapsedDirs.add(key2);
      this.render();
    });
    const busy = this.data?.runningAction;
    const hit = isRowAffected(this.data?.runningPath, `${node.path}/`);
    if (hit && (busy === "stage-file" || busy === "unstage-file" || busy === "discard-file")) {
      rowEl.addClass("ngb-sv-file-busy");
    }
    this.attachContextMenu(rowEl, (pos) => this.actions.fileMenu(node.path, group, pos));
    const slot = this.slotFactory(rowEl.createDiv({ cls: "ngb-sv-file-actions" }));
    for (const s of actionSlots("folder", group)) {
      slot(
        s.icon,
        s.tooltip,
        s.action ? () => this.actions.folderAction(group, node.path, s.action) : void 0,
        s.warn
      );
    }
    renderCountBadge(rowEl, node.count, (n) => `${n} files in ${node.path}/`);
    if (collapsed) return;
    for (const it of node.items) this.renderRow(list, group, it, depth + 1);
    for (const ch of node.children) this.renderFolderNode(list, group, ch, depth + 1);
  }
  renderRow(list, group, it, depth) {
    {
      const rowEl = list.createDiv({
        cls: depth === 0 ? "ngb-sv-file" : `ngb-sv-file ngb-ind-${Math.min(depth, 6)}`
      });
      const children = group === "untracked" && depth === 0 ? this.data?.untrackedChildren?.[it.path] : void 0;
      if (children && children.length > 0) {
        const chev = rowEl.createSpan({ cls: "ngb-sv-chevron ngb-sv-row-chevron" });
        (0, import_obsidian10.setIcon)(chev, this.collapsedDirs.has(it.path) ? "chevron-right" : "chevron-down");
        chev.setAttribute("aria-label", this.collapsedDirs.has(it.path) ? "Expand folder" : "Collapse folder");
        chev.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.collapsedDirs.has(it.path)) this.collapsedDirs.delete(it.path);
          else this.collapsedDirs.add(it.path);
          this.render();
        });
      }
      const main = rowEl.createDiv({ cls: "ngb-sv-file-main" });
      const kind = CHANGE_LABEL[it.code] ?? it.code;
      if (group === "conflicted") {
        const warn = main.createSpan({ cls: "ngb-conf-row-icon" });
        (0, import_obsidian10.setIcon)(warn, "alert-triangle");
        warn.setAttribute("aria-label", "Merge conflict");
      }
      const name = main.createSpan({ cls: "ngb-sv-file-name", text: displayName(it.path) });
      name.setAttribute("aria-label", `${it.path} - ${kind}`);
      if (it.origPath !== void 0 && it.origPath !== it.path) {
        const from = main.createSpan({ cls: "ngb-sv-file-from", text: `\u2190 ${displayName(it.origPath)}` });
        from.setAttribute("aria-label", `moved from ${it.origPath}`);
      }
      const isDir = it.path.endsWith("/");
      if (group === "conflicted") {
        main.addEventListener("click", (ev) => {
          const r = rowEl.getBoundingClientRect();
          this.actions.openConflict(it.path, { x: ev.clientX || r.left, y: ev.clientY || r.bottom });
        });
      } else if (group === "untracked" || isDir) {
        main.addEventListener("click", () => this.actions.openFile(it.path));
      } else {
        main.addEventListener("click", () => this.actions.openDiff(it.path, group));
      }
      this.attachContextMenu(rowEl, (pos) => this.actions.fileMenu(it.path, group, pos));
      if (import_obsidian10.Platform.isMobile) {
        main.createSpan({ cls: "ngb-sv-file-kind", text: kind });
      }
      const acts = rowEl.createDiv({ cls: "ngb-sv-file-actions" });
      const act = (icon, tooltip, cb, warn = false, spinning = false) => {
        const b = acts.createEl("button", {
          cls: `clickable-icon ngb-sv-icon${warn ? " ngb-sv-icon-warn" : ""}${spinning ? " ngb-anim-pulse ngb-sv-icon-active" : ""}`
        });
        b.setAttribute("aria-label", tooltip);
        (0, import_obsidian10.setIcon)(b, icon);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          cb();
        });
      };
      const busy = this.data?.runningAction;
      const hit = isRowAffected(this.data?.runningPath, it.path);
      const rowBusy = hit && (busy === "stage-file" || busy === "unstage-file" || busy === "discard-file");
      if (rowBusy) rowEl.addClass("ngb-sv-file-busy");
      if (!it.path.endsWith("/")) {
        act("go-to-file", "Open file", () => this.actions.openFile(it.path));
      }
      if (group === "staged") {
        act("minus", "Unstage", () => this.actions.unstage(it.path), false, busy === "unstage-file" && hit);
      } else {
        act("plus", "Stage", () => this.actions.stage(it.path), false, busy === "stage-file" && hit);
      }
      act("undo-2", "Discard changes", () => this.actions.discard(it.path), true, busy === "discard-file" && hit);
      const codeEl = rowEl.createSpan({
        cls: `ngb-sv-file-code ngb-code-${it.code}`,
        text: it.code
      });
      codeEl.setAttribute("aria-label", kind);
    }
  }
};
function entry(e, code) {
  return { path: e.path, code: code === "." ? "M" : code, origPath: e.origPath };
}
function isRowAffected(actionPath, rowPath) {
  if (!actionPath) return false;
  const a = actionPath.endsWith("/") ? actionPath.slice(0, -1) : actionPath;
  const r = rowPath.endsWith("/") ? rowPath.slice(0, -1) : rowPath;
  if (a === "") return false;
  return r === a || r.startsWith(a + "/");
}
function displayName(path) {
  const isDir = path.endsWith("/");
  const trimmed = isDir ? path.slice(0, -1) : path;
  const i = trimmed.lastIndexOf("/");
  const base = i >= 0 ? trimmed.slice(i + 1) : trimmed;
  const label2 = base === "" ? trimmed || path : base;
  return isDir ? `${label2}/` : label2;
}
function stateLabel(state) {
  switch (state) {
    case "clean":
      return "Clean";
    case "changed":
      return "Local changes";
    case "syncing":
      return "Working\u2026";
    case "waiting":
      return "Waiting for Termux";
    case "conflict":
      return "Conflict";
    case "error":
      return "Error";
    case "disabled":
      return "Disabled on this device";
    default:
      return state;
  }
}
function summaryToViewData(s, extra, state) {
  return {
    state,
    branch: s.detached ? "(detached)" : s.branch,
    ahead: s.ahead,
    behind: s.behind,
    staged: s.staged,
    unstaged: s.unstaged,
    untracked: s.untracked,
    untrackedChildren: s.untrackedChildren,
    conflicted: s.conflicted,
    ...extra
  };
}

// src/ui/gitMenu.ts
function suffix(scope) {
  return scope.kind === "file" ? "" : ` (${scope.count})`;
}
function noun(scope) {
  if (scope.kind === "file") return "";
  return scope.kind === "folder" ? " in folder" : " in group";
}
function buildMenuEntries(scope, f) {
  const out = [];
  const single = scope.kind === "file";
  const bulk = !single;
  const n = suffix(scope);
  const where = noun(scope);
  const empty = scope.kind !== "file" && scope.count === 0;
  if (!empty) {
    if (scope.group === "staged") {
      out.push({ action: "unstage", title: `Git: Unstage${where}${n}`, icon: "minus-circle" });
    } else if (scope.group === "unstaged" || scope.group === "untracked") {
      out.push({ action: "stage", title: `Git: Stage${where}${n}`, icon: "plus-circle" });
      out.push({
        action: "discard",
        title: scope.group === "untracked" ? `Git: Delete new file${single ? "" : "s"}${where}${n}` : `Git: Discard changes${where}${n}`,
        icon: "undo-2",
        danger: true
      });
    }
  }
  if (scope.group === "conflicted" && !empty) {
    out.push({ action: "resolve-local", title: `Git: Keep local version${where}${n}`, icon: "check", danger: true });
    out.push({ action: "resolve-remote", title: `Git: Keep remote version${where}${n}`, icon: "check-check", danger: true });
    if (scope.kind === "group") {
      out.push({ action: "abort-merge", title: "Git: Abort merge", icon: "x-circle", danger: true });
    }
  }
  if (single) {
    if (scope.group === "conflicted") {
      out.push({ action: "open-conflict", title: "Open conflict view", icon: "alert-triangle" });
    } else {
      out.push({ action: "open-diff", title: "Open diff", icon: "file-diff" });
    }
    out.push({ action: "open-history", title: "Open file history", icon: "history" });
    out.push({ action: "open-external", title: "Open in default app", icon: "external-link" });
  }
  if (scope.kind !== "group") {
    out.push({ action: "copy-path", title: "Copy path", icon: "copy" });
  }
  if (f.menuGitignore && !empty) {
    if (single && f.ignored) {
      out.push({ action: "gitignore-remove", title: "Git: Remove from .gitignore", icon: "eye" });
    } else {
      out.push({ action: "gitignore-add", title: `Git: Add to .gitignore${where}${n}`, icon: "eye-off" });
    }
  }
  if (f.menuSparse && !empty) {
    if (single && f.sparseExcluded) {
      out.push({ action: "sparse-remove", title: "Git: Show again (remove sparse exclusion)", icon: "eye" });
    } else {
      out.push({
        action: "sparse-add",
        title: `Git: Hide on this device (sparse)${where}${n}`,
        icon: "eye-off",
        danger: bulk
      });
    }
  }
  if (f.menuExclude && !empty) {
    if (single && f.excluded) {
      out.push({ action: "exclude-remove", title: "Git: Remove from .git exclude", icon: "eye" });
    } else {
      out.push({ action: "exclude-add", title: `Git: Add to .git exclude${where}${n}`, icon: "eye-off" });
    }
  }
  return out;
}

// src/ui/HistoryView.ts
var import_obsidian11 = require("obsidian");
var NGB_HISTORY_VIEW = "native-git-bridge-history";
var NGB_HISTORY_ICON = "history";
var HistoryView = class extends import_obsidian11.ItemView {
  constructor(leaf, actions) {
    super(leaf);
    this.actions = actions;
    this.entries = [];
    this.skip = 0;
    this.pageSize = 30;
    this.exhausted = false;
    this.loading = false;
    this.expanded = /* @__PURE__ */ new Set();
    /** Collapsed folder nodes in tree layout, keyed "<hash>:<folderPath>". */
    this.collapsedDirs = /* @__PURE__ */ new Set();
    this.listEl = null;
    this.moreBtn = null;
  }
  getViewType() {
    return NGB_HISTORY_VIEW;
  }
  getDisplayText() {
    return "Native Git history";
  }
  getIcon() {
    return NGB_HISTORY_ICON;
  }
  async onOpen() {
    this.renderShell();
    await this.refresh();
  }
  /** Reload from the first page (also wired to external refreshes). */
  async refresh() {
    this.entries = [];
    this.skip = 0;
    this.exhausted = false;
    this.renderShell();
    await this.loadMore();
  }
  /** Redraw from the already-loaded commits (layout toggles; no round trip). */
  rerender() {
    this.renderShell();
    for (const e of this.entries) this.renderCommit(e);
    if (this.moreBtn && this.entries.length > 0 && !this.exhausted) this.moreBtn.show();
  }
  renderShell() {
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-status-view", "ngb-history-view");
    const bar = c.createDiv({ cls: "ngb-sv-toolbar" });
    const refreshBtn = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    refreshBtn.setAttribute("aria-label", "Refresh history");
    (0, import_obsidian11.setIcon)(refreshBtn, "refresh-cw");
    if (this.loading) refreshBtn.addClass("ngb-anim-spin", "ngb-sv-icon-active");
    refreshBtn.addEventListener("click", () => void this.refresh());
    const treeBtn = bar.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    const treeOn = this.actions.treeView();
    treeBtn.setAttribute("aria-label", treeOn ? "Tree layout (tap for list)" : "List layout (tap for tree)");
    (0, import_obsidian11.setIcon)(treeBtn, treeOn ? "folder-tree" : "list");
    treeBtn.addEventListener("click", () => this.actions.toggleTree());
    this.listEl = c.createDiv({ cls: "ngb-hist-list" });
    const btns = c.createDiv({ cls: "ngb-buttons" });
    this.moreBtn = btns.createEl("button", { text: "Load more" });
    this.moreBtn.addEventListener("click", () => void this.loadMore());
    this.moreBtn.hide();
  }
  async loadMore() {
    if (this.loading) return;
    this.loading = true;
    if (this.moreBtn) {
      this.moreBtn.disabled = true;
      this.moreBtn.setText("Loading\u2026");
    }
    const waiting = this.skip === 0 ? this.listEl?.createDiv({ cls: "ngb-filehist-waiting" }) : void 0;
    if (waiting) this.renderWaiting(waiting, "Loading history");
    const page = await this.actions.loadPage(this.skip, this.pageSize);
    waiting?.remove();
    this.loading = false;
    if (this.moreBtn) {
      this.moreBtn.disabled = false;
      this.moreBtn.setText("Load more");
      this.moreBtn.show();
    }
    if (page === null) return;
    if (this.skip === 0 && page.length === 0) {
      this.listEl?.createEl("p", {
        cls: "ngb-settings-note",
        text: "No commits yet (or the repository is not reachable)."
      });
      this.moreBtn?.hide();
      return;
    }
    if (page.length < this.pageSize) {
      this.exhausted = true;
      this.moreBtn?.hide();
    }
    this.entries.push(...page);
    this.skip += page.length;
    for (const e of page) this.renderCommit(e);
  }
  /** "The runner is working" indicator, identical in all four panels. */
  renderWaiting(el, what) {
    el.empty();
    const spin = el.createSpan({ cls: "ngb-anim-spin ngb-sv-icon-active" });
    (0, import_obsidian11.setIcon)(spin, "refresh-cw");
    const text = el.createSpan({ cls: "ngb-settings-note" });
    const tick = () => {
      const p = this.actions.progressText();
      text.setText(p === "" ? `${what}\u2026` : p);
    };
    tick();
    this.registerInterval(window.setInterval(tick, 500));
  }
  renderCommit(e) {
    if (!this.listEl) return;
    const wrap = this.listEl.createDiv({ cls: "ngb-hist-commit" });
    const header = wrap.createDiv({ cls: "ngb-sv-group-header ngb-hist-header" });
    const chevron = header.createSpan({ cls: "ngb-sv-chevron" });
    const open = this.expanded.has(e.hash);
    (0, import_obsidian11.setIcon)(chevron, open ? "chevron-down" : "chevron-right");
    const titles = header.createDiv({ cls: "ngb-hist-titles" });
    titles.createDiv({ cls: "ngb-hist-subject", text: e.subject || "(no subject)" });
    titles.createDiv({
      cls: "ngb-settings-note ngb-hist-meta",
      text: `${e.hash.slice(0, 8)} \xB7 ${e.date.slice(0, 16).replace("T", " ")} \xB7 ${e.author}`
    });
    renderCountBadge(header, e.files.length, (n) => `${n} files changed in ${e.hash.slice(0, 8)}`);
    const body = wrap.createDiv({ cls: "ngb-sv-list" });
    const renderBody = () => {
      body.empty();
      if (!this.expanded.has(e.hash)) return;
      if (this.actions.treeView()) {
        const tree = buildPathTree(e.files, (f) => f.path);
        for (const f of tree.rootItems) this.renderFile(body, f, e, 0);
        for (const n of tree.folders) this.renderFolderNode(body, n, e, 0, renderBody);
        return;
      }
      for (const f of e.files) this.renderFile(body, f, e, 0);
    };
    header.addEventListener("click", () => {
      if (this.expanded.has(e.hash)) this.expanded.delete(e.hash);
      else this.expanded.add(e.hash);
      (0, import_obsidian11.setIcon)(chevron, this.expanded.has(e.hash) ? "chevron-down" : "chevron-right");
      renderBody();
    });
    renderBody();
  }
  /** Collapsible folder row inside a commit's file tree. */
  renderFolderNode(body, node, e, depth, rerenderBody) {
    const row = body.createDiv({ cls: `ngb-sv-file ngb-ind-${Math.min(depth, 6)}` });
    const key2 = `${e.hash}:${node.path}`;
    const collapsed = this.collapsedDirs.has(key2);
    const main = row.createDiv({ cls: "ngb-sv-file-main" });
    const chev = main.createSpan({ cls: "ngb-sv-chevron ngb-sv-row-chevron" });
    (0, import_obsidian11.setIcon)(chev, collapsed ? "chevron-right" : "chevron-down");
    main.createSpan({ cls: "ngb-sv-file-name ngb-sv-folder-name", text: `${node.name}/` });
    main.addEventListener("click", () => {
      if (collapsed) this.collapsedDirs.delete(key2);
      else this.collapsedDirs.add(key2);
      rerenderBody();
    });
    const acts = row.createDiv({ cls: "ngb-sv-file-actions" });
    const spacer = acts.createEl("button", { cls: "clickable-icon ngb-sv-icon ngb-slot-inactive" });
    (0, import_obsidian11.setIcon)(spacer, "circle");
    spacer.setAttribute("aria-hidden", "true");
    spacer.tabIndex = -1;
    renderCountBadge(row, node.count, (n) => `${n} files in ${node.path}/`);
    if (collapsed) return;
    for (const f of node.items) this.renderFile(body, f, e, depth + 1);
    for (const ch of node.children) this.renderFolderNode(body, ch, e, depth + 1, rerenderBody);
  }
  renderFile(body, f, e, depth) {
    const row = body.createDiv({
      cls: depth === 0 ? "ngb-sv-file" : `ngb-sv-file ngb-ind-${Math.min(depth, 6)}`
    });
    const main = row.createDiv({ cls: "ngb-sv-file-main" });
    const name = main.createSpan({ cls: "ngb-sv-file-name", text: displayName2(f.path) });
    name.setAttribute("aria-label", `${f.path} @ ${e.hash.slice(0, 8)}`);
    if (f.origPath) {
      main.createSpan({ cls: "ngb-settings-note ngb-hist-rename", text: `\u2190 ${f.origPath}` });
    }
    main.addEventListener("click", () => this.actions.openDiffAtCommit(f, e));
    const acts = row.createDiv({ cls: "ngb-sv-file-actions" });
    const openBtn = acts.createEl("button", { cls: "clickable-icon ngb-sv-icon" });
    openBtn.setAttribute("aria-label", "Open file (current version)");
    (0, import_obsidian11.setIcon)(openBtn, "go-to-file");
    openBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.actions.openFile(f.path);
    });
    const codeEl = row.createSpan({ cls: `ngb-sv-file-code ngb-code-${f.code}`, text: f.code });
    codeEl.setAttribute("aria-label", f.code);
  }
  /** Number of loaded commits (used by tests and diagnostics). */
  get loadedCount() {
    return this.entries.length;
  }
  get isExhausted() {
    return this.exhausted;
  }
};
function displayName2(path) {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

// src/ui/DiffView.ts
var import_obsidian12 = require("obsidian");

// node_modules/diff2html/lib-esm/types.js
var LineType;
(function(LineType2) {
  LineType2["INSERT"] = "insert";
  LineType2["DELETE"] = "delete";
  LineType2["CONTEXT"] = "context";
})(LineType || (LineType = {}));
var OutputFormatType = {
  LINE_BY_LINE: "line-by-line",
  SIDE_BY_SIDE: "side-by-side"
};
var LineMatchingType = {
  LINES: "lines",
  WORDS: "words",
  NONE: "none"
};
var DiffStyleType = {
  WORD: "word",
  CHAR: "char"
};
var ColorSchemeType;
(function(ColorSchemeType2) {
  ColorSchemeType2["AUTO"] = "auto";
  ColorSchemeType2["DARK"] = "dark";
  ColorSchemeType2["LIGHT"] = "light";
})(ColorSchemeType || (ColorSchemeType = {}));

// node_modules/diff2html/lib-esm/utils.js
var specials = [
  "-",
  "[",
  "]",
  "/",
  "{",
  "}",
  "(",
  ")",
  "*",
  "+",
  "?",
  ".",
  "\\",
  "^",
  "$",
  "|"
];
var regex = RegExp("[" + specials.join("\\") + "]", "g");
function escapeForRegExp(str) {
  return str.replace(regex, "\\$&");
}
function unifyPath(path) {
  return path ? path.replace(/\\/g, "/") : path;
}
function hashCode(text) {
  let i, chr, len;
  let hash = 0;
  for (i = 0, len = text.length; i < len; i++) {
    chr = text.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return hash;
}
function max(arr) {
  const length = arr.length;
  let max2 = -Infinity;
  for (let i = 0; i < length; i++) {
    max2 = Math.max(max2, arr[i]);
  }
  return max2;
}

// node_modules/diff2html/lib-esm/diff-parser.js
function getExtension(filename, language) {
  const filenameParts = filename.split(".");
  return filenameParts.length > 1 ? filenameParts[filenameParts.length - 1] : language;
}
function startsWithAny(str, prefixes) {
  return prefixes.reduce((startsWith, prefix) => startsWith || str.startsWith(prefix), false);
}
var baseDiffFilenamePrefixes = ["a/", "b/", "i/", "w/", "c/", "o/"];
function getFilename(line, linePrefix, extraPrefix) {
  const prefixes = extraPrefix !== void 0 ? [...baseDiffFilenamePrefixes, extraPrefix] : baseDiffFilenamePrefixes;
  const FilenameRegExp = linePrefix ? new RegExp(`^${escapeForRegExp(linePrefix)} "?(.+?)"?$`) : new RegExp('^"?(.+?)"?$');
  const [, filename = ""] = FilenameRegExp.exec(line) || [];
  const matchingPrefix = prefixes.find((p) => filename.indexOf(p) === 0);
  const fnameWithoutPrefix = matchingPrefix ? filename.slice(matchingPrefix.length) : filename;
  return fnameWithoutPrefix.replace(/\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? [+-]\d{4}.*$/, "");
}
function getSrcFilename(line, srcPrefix) {
  return getFilename(line, "---", srcPrefix);
}
function getDstFilename(line, dstPrefix) {
  return getFilename(line, "+++", dstPrefix);
}
function parse(diffInput, config = {}) {
  const files = [];
  let currentFile = null;
  let currentBlock = null;
  let oldLine = null;
  let oldLine2 = null;
  let newLine = null;
  let possibleOldName = null;
  let possibleNewName = null;
  const oldFileNameHeader = "--- ";
  const newFileNameHeader = "+++ ";
  const hunkHeaderPrefix = "@@";
  const oldMode = /^old mode (\d{6})/;
  const newMode = /^new mode (\d{6})/;
  const deletedFileMode = /^deleted file mode (\d{6})/;
  const newFileMode = /^new file mode (\d{6})/;
  const copyFrom = /^copy from "?(.+)"?/;
  const copyTo = /^copy to "?(.+)"?/;
  const renameFrom = /^rename from "?(.+)"?/;
  const renameTo = /^rename to "?(.+)"?/;
  const similarityIndex = /^similarity index (\d+)%/;
  const dissimilarityIndex = /^dissimilarity index (\d+)%/;
  const index = /^index ([\da-z]+)\.\.([\da-z]+)\s*(\d{6})?/;
  const binaryFiles = /^Binary files (.*) and (.*) differ/;
  const binaryDiff = /^GIT binary patch/;
  const combinedIndex = /^index ([\da-z]+),([\da-z]+)\.\.([\da-z]+)/;
  const combinedMode = /^mode (\d{6}),(\d{6})\.\.(\d{6})/;
  const combinedNewFile = /^new file mode (\d{6})/;
  const combinedDeletedFile = /^deleted file mode (\d{6}),(\d{6})/;
  const diffLines = diffInput.replace(/\\ No newline at end of file/g, "").replace(/\r\n?/g, "\n").split("\n");
  function saveBlock() {
    if (currentBlock !== null && currentFile !== null) {
      currentFile.blocks.push(currentBlock);
      currentBlock = null;
    }
  }
  function saveFile() {
    if (currentFile !== null) {
      if (!currentFile.oldName && possibleOldName !== null) {
        currentFile.oldName = possibleOldName;
      }
      if (!currentFile.newName && possibleNewName !== null) {
        currentFile.newName = possibleNewName;
      }
      if (currentFile.newName) {
        files.push(currentFile);
        currentFile = null;
      }
    }
    possibleOldName = null;
    possibleNewName = null;
  }
  function startFile() {
    saveBlock();
    saveFile();
    currentFile = {
      blocks: [],
      deletedLines: 0,
      addedLines: 0
    };
  }
  function startBlock(line) {
    saveBlock();
    let values;
    if (currentFile !== null) {
      if (values = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@.*/.exec(line)) {
        currentFile.isCombined = false;
        oldLine = parseInt(values[1], 10);
        newLine = parseInt(values[2], 10);
      } else if (values = /^@@@ -(\d+)(?:,\d+)? -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@@.*/.exec(line)) {
        currentFile.isCombined = true;
        oldLine = parseInt(values[1], 10);
        oldLine2 = parseInt(values[2], 10);
        newLine = parseInt(values[3], 10);
      } else {
        if (line.startsWith(hunkHeaderPrefix)) {
          console.error("Failed to parse lines, starting in 0!");
        }
        oldLine = 0;
        newLine = 0;
        currentFile.isCombined = false;
      }
    }
    currentBlock = {
      lines: [],
      oldStartLine: oldLine,
      oldStartLine2: oldLine2,
      newStartLine: newLine,
      header: line
    };
  }
  function createLine(line) {
    if (currentFile === null || currentBlock === null || oldLine === null || newLine === null)
      return;
    const currentLine = {
      content: line
    };
    const addedPrefixes = currentFile.isCombined ? ["+ ", " +", "++"] : ["+"];
    const deletedPrefixes = currentFile.isCombined ? ["- ", " -", "--"] : ["-"];
    if (startsWithAny(line, addedPrefixes)) {
      currentFile.addedLines++;
      currentLine.type = LineType.INSERT;
      currentLine.oldNumber = void 0;
      currentLine.newNumber = newLine++;
    } else if (startsWithAny(line, deletedPrefixes)) {
      currentFile.deletedLines++;
      currentLine.type = LineType.DELETE;
      currentLine.oldNumber = oldLine++;
      currentLine.newNumber = void 0;
    } else {
      currentLine.type = LineType.CONTEXT;
      currentLine.oldNumber = oldLine++;
      currentLine.newNumber = newLine++;
    }
    currentBlock.lines.push(currentLine);
  }
  function existHunkHeader(line, lineIdx) {
    let idx = lineIdx;
    while (idx < diffLines.length - 3) {
      if (line.startsWith("diff")) {
        return false;
      }
      if (diffLines[idx].startsWith(oldFileNameHeader) && diffLines[idx + 1].startsWith(newFileNameHeader) && diffLines[idx + 2].startsWith(hunkHeaderPrefix)) {
        return true;
      }
      idx++;
    }
    return false;
  }
  diffLines.forEach((line, lineIndex) => {
    if (!line || line.startsWith("*")) {
      return;
    }
    let values;
    const prevLine = diffLines[lineIndex - 1];
    const nxtLine = diffLines[lineIndex + 1];
    const afterNxtLine = diffLines[lineIndex + 2];
    if (line.startsWith("diff --git") || line.startsWith("diff --combined")) {
      startFile();
      const gitDiffStart = /^diff --git "?([a-ciow]\/.+)"? "?([a-ciow]\/.+)"?/;
      if (values = gitDiffStart.exec(line)) {
        possibleOldName = getFilename(values[1], void 0, config.dstPrefix);
        possibleNewName = getFilename(values[2], void 0, config.srcPrefix);
      }
      if (currentFile === null) {
        throw new Error("Where is my file !!!");
      }
      currentFile.isGitDiff = true;
      return;
    }
    if (line.startsWith("Binary files") && !(currentFile === null || currentFile === void 0 ? void 0 : currentFile.isGitDiff)) {
      startFile();
      const unixDiffBinaryStart = /^Binary files "?([a-ciow]\/.+)"? and "?([a-ciow]\/.+)"? differ/;
      if (values = unixDiffBinaryStart.exec(line)) {
        possibleOldName = getFilename(values[1], void 0, config.dstPrefix);
        possibleNewName = getFilename(values[2], void 0, config.srcPrefix);
      }
      if (currentFile === null) {
        throw new Error("Where is my file !!!");
      }
      currentFile.isBinary = true;
      return;
    }
    if (!currentFile || !currentFile.isGitDiff && currentFile && line.startsWith(oldFileNameHeader) && nxtLine.startsWith(newFileNameHeader) && afterNxtLine.startsWith(hunkHeaderPrefix)) {
      startFile();
    }
    if (currentFile === null || currentFile === void 0 ? void 0 : currentFile.isTooBig) {
      return;
    }
    if (currentFile && (typeof config.diffMaxChanges === "number" && currentFile.addedLines + currentFile.deletedLines > config.diffMaxChanges || typeof config.diffMaxLineLength === "number" && line.length > config.diffMaxLineLength)) {
      currentFile.isTooBig = true;
      currentFile.addedLines = 0;
      currentFile.deletedLines = 0;
      currentFile.blocks = [];
      currentBlock = null;
      const message = typeof config.diffTooBigMessage === "function" ? config.diffTooBigMessage(files.length) : "Diff too big to be displayed";
      startBlock(message);
      return;
    }
    if (line.startsWith(oldFileNameHeader) && nxtLine.startsWith(newFileNameHeader) || line.startsWith(newFileNameHeader) && prevLine.startsWith(oldFileNameHeader)) {
      if (currentFile && !currentFile.oldName && line.startsWith("--- ") && (values = getSrcFilename(line, config.srcPrefix))) {
        currentFile.oldName = values;
        currentFile.language = getExtension(currentFile.oldName, currentFile.language);
        return;
      }
      if (currentFile && !currentFile.newName && line.startsWith("+++ ") && (values = getDstFilename(line, config.dstPrefix))) {
        currentFile.newName = values;
        currentFile.language = getExtension(currentFile.newName, currentFile.language);
        return;
      }
    }
    if (currentFile && (line.startsWith(hunkHeaderPrefix) || currentFile.isGitDiff && currentFile.oldName && currentFile.newName && !currentBlock)) {
      startBlock(line);
      return;
    }
    if (currentBlock && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
      createLine(line);
      return;
    }
    const doesNotExistHunkHeader = !existHunkHeader(line, lineIndex);
    if (currentFile === null) {
      throw new Error("Where is my file !!!");
    }
    if (values = oldMode.exec(line)) {
      currentFile.oldMode = values[1];
    } else if (values = newMode.exec(line)) {
      currentFile.newMode = values[1];
    } else if (values = deletedFileMode.exec(line)) {
      currentFile.deletedFileMode = values[1];
      currentFile.isDeleted = true;
    } else if (values = newFileMode.exec(line)) {
      currentFile.newFileMode = values[1];
      currentFile.isNew = true;
    } else if (values = copyFrom.exec(line)) {
      if (doesNotExistHunkHeader) {
        currentFile.oldName = values[1];
      }
      currentFile.isCopy = true;
    } else if (values = copyTo.exec(line)) {
      if (doesNotExistHunkHeader) {
        currentFile.newName = values[1];
      }
      currentFile.isCopy = true;
    } else if (values = renameFrom.exec(line)) {
      if (doesNotExistHunkHeader) {
        currentFile.oldName = values[1];
      }
      currentFile.isRename = true;
    } else if (values = renameTo.exec(line)) {
      if (doesNotExistHunkHeader) {
        currentFile.newName = values[1];
      }
      currentFile.isRename = true;
    } else if (values = binaryFiles.exec(line)) {
      currentFile.isBinary = true;
      currentFile.oldName = getFilename(values[1], void 0, config.srcPrefix);
      currentFile.newName = getFilename(values[2], void 0, config.dstPrefix);
      startBlock("Binary file");
    } else if (binaryDiff.test(line)) {
      currentFile.isBinary = true;
      startBlock(line);
    } else if (values = similarityIndex.exec(line)) {
      currentFile.unchangedPercentage = parseInt(values[1], 10);
    } else if (values = dissimilarityIndex.exec(line)) {
      currentFile.changedPercentage = parseInt(values[1], 10);
    } else if (values = index.exec(line)) {
      currentFile.checksumBefore = values[1];
      currentFile.checksumAfter = values[2];
      if (values[3])
        currentFile.mode = values[3];
    } else if (values = combinedIndex.exec(line)) {
      currentFile.checksumBefore = [values[2], values[3]];
      currentFile.checksumAfter = values[1];
    } else if (values = combinedMode.exec(line)) {
      currentFile.oldMode = [values[2], values[3]];
      currentFile.newMode = values[1];
    } else if (values = combinedNewFile.exec(line)) {
      currentFile.newFileMode = values[1];
      currentFile.isNew = true;
    } else if (values = combinedDeletedFile.exec(line)) {
      currentFile.deletedFileMode = values[1];
      currentFile.isDeleted = true;
    }
  });
  saveBlock();
  saveFile();
  return files;
}

// node_modules/diff/libesm/diff/base.js
var Diff = class {
  diff(oldStr, newStr, options = {}) {
    let callback;
    if (typeof options === "function") {
      callback = options;
      options = {};
    } else if ("callback" in options) {
      callback = options.callback;
    }
    const oldString = this.castInput(oldStr, options);
    const newString = this.castInput(newStr, options);
    const oldTokens = this.removeEmpty(this.tokenize(oldString, options));
    const newTokens = this.removeEmpty(this.tokenize(newString, options));
    return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
  }
  diffWithOptionsObj(oldTokens, newTokens, options, callback) {
    var _a;
    const done = (value) => {
      value = this.postProcess(value, options);
      if (callback) {
        setTimeout(function() {
          callback(value);
        }, 0);
        return void 0;
      } else {
        return value;
      }
    };
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let editLength = 1;
    let maxEditLength = newLen + oldLen;
    if (options.maxEditLength != null) {
      maxEditLength = Math.min(maxEditLength, options.maxEditLength);
    }
    const maxExecutionTime = (_a = options.timeout) !== null && _a !== void 0 ? _a : Infinity;
    const abortAfterTimestamp = Date.now() + maxExecutionTime;
    const bestPath = [{ oldPos: -1, lastComponent: void 0 }];
    let newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
    if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
      return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
    }
    let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
    const execEditLength = () => {
      for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
        let basePath;
        const removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
        if (removePath) {
          bestPath[diagonalPath - 1] = void 0;
        }
        let canAdd = false;
        if (addPath) {
          const addPathNewPos = addPath.oldPos - diagonalPath;
          canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
        }
        const canRemove = removePath && removePath.oldPos + 1 < oldLen;
        if (!canAdd && !canRemove) {
          bestPath[diagonalPath] = void 0;
          continue;
        }
        if (!canRemove || canAdd && removePath.oldPos < addPath.oldPos) {
          basePath = this.addToPath(addPath, true, false, 0, options);
        } else {
          basePath = this.addToPath(removePath, false, true, 1, options);
        }
        newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
        if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
          return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
        } else {
          bestPath[diagonalPath] = basePath;
          if (basePath.oldPos + 1 >= oldLen) {
            maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
          }
          if (newPos + 1 >= newLen) {
            minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
          }
        }
      }
      editLength++;
    };
    if (callback) {
      (function exec() {
        setTimeout(function() {
          if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
            return callback(void 0);
          }
          if (!execEditLength()) {
            exec();
          }
        }, 0);
      })();
    } else {
      while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
        const ret = execEditLength();
        if (ret) {
          return ret;
        }
      }
    }
  }
  addToPath(path, added, removed, oldPosInc, options) {
    const last = path.lastComponent;
    if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) {
      return {
        oldPos: path.oldPos + oldPosInc,
        lastComponent: { count: last.count + 1, added, removed, previousComponent: last.previousComponent }
      };
    } else {
      return {
        oldPos: path.oldPos + oldPosInc,
        lastComponent: { count: 1, added, removed, previousComponent: last }
      };
    }
  }
  extractCommon(basePath, newTokens, oldTokens, diagonalPath, options) {
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
    while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
      newPos++;
      oldPos++;
      commonCount++;
      if (options.oneChangePerToken) {
        basePath.lastComponent = { count: 1, previousComponent: basePath.lastComponent, added: false, removed: false };
      }
    }
    if (commonCount && !options.oneChangePerToken) {
      basePath.lastComponent = { count: commonCount, previousComponent: basePath.lastComponent, added: false, removed: false };
    }
    basePath.oldPos = oldPos;
    return newPos;
  }
  equals(left, right, options) {
    if (options.comparator) {
      return options.comparator(left, right);
    } else {
      return left === right || !!options.ignoreCase && left.toLowerCase() === right.toLowerCase();
    }
  }
  removeEmpty(array) {
    const ret = [];
    for (let i = 0; i < array.length; i++) {
      if (array[i]) {
        ret.push(array[i]);
      }
    }
    return ret;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  castInput(value, options) {
    return value;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tokenize(value, options) {
    return Array.from(value);
  }
  join(chars) {
    return chars.join("");
  }
  postProcess(changeObjects, options) {
    return changeObjects;
  }
  get useLongestToken() {
    return false;
  }
  buildValues(lastComponent, newTokens, oldTokens) {
    const components = [];
    let nextComponent;
    while (lastComponent) {
      components.push(lastComponent);
      nextComponent = lastComponent.previousComponent;
      delete lastComponent.previousComponent;
      lastComponent = nextComponent;
    }
    components.reverse();
    const componentLen = components.length;
    let componentPos = 0, newPos = 0, oldPos = 0;
    for (; componentPos < componentLen; componentPos++) {
      const component = components[componentPos];
      if (!component.removed) {
        if (!component.added && this.useLongestToken) {
          let value = newTokens.slice(newPos, newPos + component.count);
          value = value.map(function(value2, i) {
            const oldValue = oldTokens[oldPos + i];
            return oldValue.length > value2.length ? oldValue : value2;
          });
          component.value = this.join(value);
        } else {
          component.value = this.join(newTokens.slice(newPos, newPos + component.count));
        }
        newPos += component.count;
        if (!component.added) {
          oldPos += component.count;
        }
      } else {
        component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
        oldPos += component.count;
      }
    }
    return components;
  }
};

// node_modules/diff/libesm/diff/character.js
var CharacterDiff = class extends Diff {
};
var characterDiff = new CharacterDiff();
function diffChars(oldStr, newStr, options) {
  return characterDiff.diff(oldStr, newStr, options);
}

// node_modules/diff/libesm/util/string.js
function longestCommonPrefix(str1, str2) {
  let i;
  for (i = 0; i < str1.length && i < str2.length; i++) {
    if (str1[i] != str2[i]) {
      return str1.slice(0, i);
    }
  }
  return str1.slice(0, i);
}
function longestCommonSuffix(str1, str2) {
  let i;
  if (!str1 || !str2 || str1[str1.length - 1] != str2[str2.length - 1]) {
    return "";
  }
  for (i = 0; i < str1.length && i < str2.length; i++) {
    if (str1[str1.length - (i + 1)] != str2[str2.length - (i + 1)]) {
      return str1.slice(-i);
    }
  }
  return str1.slice(-i);
}
function replacePrefix(string, oldPrefix, newPrefix) {
  if (string.slice(0, oldPrefix.length) != oldPrefix) {
    throw Error(`string ${JSON.stringify(string)} doesn't start with prefix ${JSON.stringify(oldPrefix)}; this is a bug`);
  }
  return newPrefix + string.slice(oldPrefix.length);
}
function replaceSuffix(string, oldSuffix, newSuffix) {
  if (!oldSuffix) {
    return string + newSuffix;
  }
  if (string.slice(-oldSuffix.length) != oldSuffix) {
    throw Error(`string ${JSON.stringify(string)} doesn't end with suffix ${JSON.stringify(oldSuffix)}; this is a bug`);
  }
  return string.slice(0, -oldSuffix.length) + newSuffix;
}
function removePrefix(string, oldPrefix) {
  return replacePrefix(string, oldPrefix, "");
}
function removeSuffix(string, oldSuffix) {
  return replaceSuffix(string, oldSuffix, "");
}
function maximumOverlap(string1, string2) {
  return string2.slice(0, overlapCount(string1, string2));
}
function overlapCount(a, b) {
  let startA = 0;
  if (a.length > b.length) {
    startA = a.length - b.length;
  }
  let endB = b.length;
  if (a.length < b.length) {
    endB = a.length;
  }
  const map = Array(endB);
  let k = 0;
  map[0] = 0;
  for (let j = 1; j < endB; j++) {
    if (b[j] == b[k]) {
      map[j] = map[k];
    } else {
      map[j] = k;
    }
    while (k > 0 && b[j] != b[k]) {
      k = map[k];
    }
    if (b[j] == b[k]) {
      k++;
    }
  }
  k = 0;
  for (let i = startA; i < a.length; i++) {
    while (k > 0 && a[i] != b[k]) {
      k = map[k];
    }
    if (a[i] == b[k]) {
      k++;
    }
  }
  return k;
}
function segment(string, segmenter) {
  const parts = [];
  for (const segmentObj of Array.from(segmenter.segment(string))) {
    const segment2 = segmentObj.segment;
    if (parts.length && /\s/.test(parts[parts.length - 1]) && /\s/.test(segment2)) {
      parts[parts.length - 1] += segment2;
    } else {
      parts.push(segment2);
    }
  }
  return parts;
}
function trailingWs(string, segmenter) {
  if (segmenter) {
    return leadingAndTrailingWs(string, segmenter)[1];
  }
  let i;
  for (i = string.length - 1; i >= 0; i--) {
    if (!string[i].match(/\s/)) {
      break;
    }
  }
  return string.substring(i + 1);
}
function leadingWs(string, segmenter) {
  if (segmenter) {
    return leadingAndTrailingWs(string, segmenter)[0];
  }
  const match = string.match(/^\s*/);
  return match ? match[0] : "";
}
function leadingAndTrailingWs(string, segmenter) {
  if (!segmenter) {
    return [leadingWs(string), trailingWs(string)];
  }
  if (segmenter.resolvedOptions().granularity != "word") {
    throw new Error('The segmenter passed must have a granularity of "word"');
  }
  const segments = segment(string, segmenter);
  const firstSeg = segments[0];
  const lastSeg = segments[segments.length - 1];
  const head = /\s/.test(firstSeg) ? firstSeg : "";
  const tail = /\s/.test(lastSeg) ? lastSeg : "";
  return [head, tail];
}

// node_modules/diff/libesm/diff/word.js
var extendedWordChars = "a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}";
var tokenizeIncludingWhitespace = new RegExp(`[${extendedWordChars}]+|\\s+|[^${extendedWordChars}]`, "ug");
var WordDiff = class extends Diff {
  equals(left, right, options) {
    if (options.ignoreCase) {
      left = left.toLowerCase();
      right = right.toLowerCase();
    }
    return left.trim() === right.trim();
  }
  tokenize(value, options = {}) {
    let parts;
    if (options.intlSegmenter) {
      const segmenter = options.intlSegmenter;
      if (segmenter.resolvedOptions().granularity != "word") {
        throw new Error('The segmenter passed must have a granularity of "word"');
      }
      parts = segment(value, segmenter);
    } else {
      parts = value.match(tokenizeIncludingWhitespace) || [];
    }
    const tokens = [];
    let prevPart = null;
    parts.forEach((part) => {
      if (/\s/.test(part)) {
        if (prevPart == null) {
          tokens.push(part);
        } else {
          tokens.push(tokens.pop() + part);
        }
      } else if (prevPart != null && /\s/.test(prevPart)) {
        if (tokens[tokens.length - 1] == prevPart) {
          tokens.push(tokens.pop() + part);
        } else {
          tokens.push(prevPart + part);
        }
      } else {
        tokens.push(part);
      }
      prevPart = part;
    });
    return tokens;
  }
  join(tokens) {
    return tokens.map((token, i) => {
      if (i == 0) {
        return token;
      } else {
        return token.replace(/^\s+/, "");
      }
    }).join("");
  }
  postProcess(changes, options) {
    if (!changes || options.oneChangePerToken) {
      return changes;
    }
    let lastKeep = null;
    let insertion = null;
    let deletion = null;
    changes.forEach((change) => {
      if (change.added) {
        insertion = change;
      } else if (change.removed) {
        deletion = change;
      } else {
        if (insertion || deletion) {
          dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, change, options.intlSegmenter);
        }
        lastKeep = change;
        insertion = null;
        deletion = null;
      }
    });
    if (insertion || deletion) {
      dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, null, options.intlSegmenter);
    }
    return changes;
  }
};
var wordDiff = new WordDiff();
function dedupeWhitespaceInChangeObjects(startKeep, deletion, insertion, endKeep, segmenter) {
  if (deletion && insertion) {
    const [oldWsPrefix, oldWsSuffix] = leadingAndTrailingWs(deletion.value, segmenter);
    const [newWsPrefix, newWsSuffix] = leadingAndTrailingWs(insertion.value, segmenter);
    if (startKeep) {
      const commonWsPrefix = longestCommonPrefix(oldWsPrefix, newWsPrefix);
      startKeep.value = replaceSuffix(startKeep.value, newWsPrefix, commonWsPrefix);
      deletion.value = removePrefix(deletion.value, commonWsPrefix);
      insertion.value = removePrefix(insertion.value, commonWsPrefix);
    }
    if (endKeep) {
      const commonWsSuffix = longestCommonSuffix(oldWsSuffix, newWsSuffix);
      endKeep.value = replacePrefix(endKeep.value, newWsSuffix, commonWsSuffix);
      deletion.value = removeSuffix(deletion.value, commonWsSuffix);
      insertion.value = removeSuffix(insertion.value, commonWsSuffix);
    }
  } else if (insertion) {
    if (startKeep) {
      const ws = leadingWs(insertion.value, segmenter);
      insertion.value = insertion.value.substring(ws.length);
    }
    if (endKeep) {
      const ws = leadingWs(endKeep.value, segmenter);
      endKeep.value = endKeep.value.substring(ws.length);
    }
  } else if (startKeep && endKeep) {
    const newWsFull = leadingWs(endKeep.value, segmenter), [delWsStart, delWsEnd] = leadingAndTrailingWs(deletion.value, segmenter);
    const newWsStart = longestCommonPrefix(newWsFull, delWsStart);
    deletion.value = removePrefix(deletion.value, newWsStart);
    const newWsEnd = longestCommonSuffix(removePrefix(newWsFull, newWsStart), delWsEnd);
    deletion.value = removeSuffix(deletion.value, newWsEnd);
    endKeep.value = replacePrefix(endKeep.value, newWsFull, newWsEnd);
    startKeep.value = replaceSuffix(startKeep.value, newWsFull, newWsFull.slice(0, newWsFull.length - newWsEnd.length));
  } else if (endKeep) {
    const endKeepWsPrefix = leadingWs(endKeep.value, segmenter);
    const deletionWsSuffix = trailingWs(deletion.value, segmenter);
    const overlap = maximumOverlap(deletionWsSuffix, endKeepWsPrefix);
    deletion.value = removeSuffix(deletion.value, overlap);
  } else if (startKeep) {
    const startKeepWsSuffix = trailingWs(startKeep.value, segmenter);
    const deletionWsPrefix = leadingWs(deletion.value, segmenter);
    const overlap = maximumOverlap(startKeepWsSuffix, deletionWsPrefix);
    deletion.value = removePrefix(deletion.value, overlap);
  }
}
var WordsWithSpaceDiff = class extends Diff {
  tokenize(value) {
    const regex2 = new RegExp(`(\\r?\\n)|[${extendedWordChars}]+|[^\\S\\n\\r]+|[^${extendedWordChars}]`, "ug");
    return value.match(regex2) || [];
  }
};
var wordsWithSpaceDiff = new WordsWithSpaceDiff();
function diffWordsWithSpace(oldStr, newStr, options) {
  return wordsWithSpaceDiff.diff(oldStr, newStr, options);
}

// node_modules/diff2html/lib-esm/rematch.js
function levenshtein(a, b) {
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }
  const matrix = [];
  let i;
  for (i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  let j;
  for (j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (i = 1; i <= b.length; i++) {
    for (j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
      }
    }
  }
  return matrix[b.length][a.length];
}
function newDistanceFn(str) {
  return (x, y) => {
    const xValue = str(x).trim();
    const yValue = str(y).trim();
    const lev = levenshtein(xValue, yValue);
    return lev / (xValue.length + yValue.length);
  };
}
function newMatcherFn(distance2) {
  function findBestMatch(a, b, cache = /* @__PURE__ */ new Map()) {
    let bestMatchDist = Infinity;
    let bestMatch;
    for (let i = 0; i < a.length; ++i) {
      for (let j = 0; j < b.length; ++j) {
        const cacheKey = JSON.stringify([a[i], b[j]]);
        let md;
        if (!(cache.has(cacheKey) && (md = cache.get(cacheKey)))) {
          md = distance2(a[i], b[j]);
          cache.set(cacheKey, md);
        }
        if (md < bestMatchDist) {
          bestMatchDist = md;
          bestMatch = { indexA: i, indexB: j, score: bestMatchDist };
        }
      }
    }
    return bestMatch;
  }
  function group(a, b, level = 0, cache = /* @__PURE__ */ new Map()) {
    const bm = findBestMatch(a, b, cache);
    if (!bm || a.length + b.length < 3) {
      return [[a, b]];
    }
    const a1 = a.slice(0, bm.indexA);
    const b1 = b.slice(0, bm.indexB);
    const aMatch = [a[bm.indexA]];
    const bMatch = [b[bm.indexB]];
    const tailA = bm.indexA + 1;
    const tailB = bm.indexB + 1;
    const a2 = a.slice(tailA);
    const b2 = b.slice(tailB);
    const group1 = group(a1, b1, level + 1, cache);
    const groupMatch = group(aMatch, bMatch, level + 1, cache);
    const group2 = group(a2, b2, level + 1, cache);
    let result = groupMatch;
    if (bm.indexA > 0 || bm.indexB > 0) {
      result = group1.concat(result);
    }
    if (a.length > tailA || b.length > tailB) {
      result = result.concat(group2);
    }
    return result;
  }
  return group;
}

// node_modules/diff2html/lib-esm/render-utils.js
var CSSLineClass = {
  INSERTS: "d2h-ins",
  DELETES: "d2h-del",
  CONTEXT: "d2h-cntx",
  INFO: "d2h-info",
  INSERT_CHANGES: "d2h-ins d2h-change",
  DELETE_CHANGES: "d2h-del d2h-change"
};
var defaultRenderConfig = {
  matching: LineMatchingType.NONE,
  matchWordsThreshold: 0.25,
  maxLineLengthHighlight: 1e4,
  diffStyle: DiffStyleType.WORD,
  colorScheme: ColorSchemeType.LIGHT
};
var separator = "/";
var distance = newDistanceFn((change) => change.value);
var matcher = newMatcherFn(distance);
function isDevNullName(name) {
  return name.indexOf("dev/null") !== -1;
}
function removeInsElements(line) {
  return line.replace(/(<ins[^>]*>((.|\n)*?)<\/ins>)/g, "");
}
function removeDelElements(line) {
  return line.replace(/(<del[^>]*>((.|\n)*?)<\/del>)/g, "");
}
function toCSSClass(lineType) {
  switch (lineType) {
    case LineType.CONTEXT:
      return CSSLineClass.CONTEXT;
    case LineType.INSERT:
      return CSSLineClass.INSERTS;
    case LineType.DELETE:
      return CSSLineClass.DELETES;
  }
}
function colorSchemeToCss(colorScheme) {
  switch (colorScheme) {
    case ColorSchemeType.DARK:
      return "d2h-dark-color-scheme";
    case ColorSchemeType.AUTO:
      return "d2h-auto-color-scheme";
    case ColorSchemeType.LIGHT:
    default:
      return "d2h-light-color-scheme";
  }
}
function prefixLength(isCombined) {
  return isCombined ? 2 : 1;
}
function escapeForHtml(str) {
  return str.slice(0).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/\//g, "&#x2F;");
}
function deconstructLine(line, isCombined, escape = true) {
  const indexToSplit = prefixLength(isCombined);
  return {
    prefix: line.substring(0, indexToSplit),
    content: escape ? escapeForHtml(line.substring(indexToSplit)) : line.substring(indexToSplit)
  };
}
function filenameDiff(file) {
  const oldFilename = unifyPath(file.oldName);
  const newFilename = unifyPath(file.newName);
  if (oldFilename !== newFilename && !isDevNullName(oldFilename) && !isDevNullName(newFilename)) {
    const prefixPaths = [];
    const suffixPaths = [];
    const oldFilenameParts = oldFilename.split(separator);
    const newFilenameParts = newFilename.split(separator);
    const oldFilenamePartsSize = oldFilenameParts.length;
    const newFilenamePartsSize = newFilenameParts.length;
    let i = 0;
    let j = oldFilenamePartsSize - 1;
    let k = newFilenamePartsSize - 1;
    while (i < j && i < k) {
      if (oldFilenameParts[i] === newFilenameParts[i]) {
        prefixPaths.push(newFilenameParts[i]);
        i += 1;
      } else {
        break;
      }
    }
    while (j > i && k > i) {
      if (oldFilenameParts[j] === newFilenameParts[k]) {
        suffixPaths.unshift(newFilenameParts[k]);
        j -= 1;
        k -= 1;
      } else {
        break;
      }
    }
    const finalPrefix = prefixPaths.join(separator);
    const finalSuffix = suffixPaths.join(separator);
    const oldRemainingPath = oldFilenameParts.slice(i, j + 1).join(separator);
    const newRemainingPath = newFilenameParts.slice(i, k + 1).join(separator);
    if (finalPrefix.length && finalSuffix.length) {
      return finalPrefix + separator + "{" + oldRemainingPath + " \u2192 " + newRemainingPath + "}" + separator + finalSuffix;
    } else if (finalPrefix.length) {
      return finalPrefix + separator + "{" + oldRemainingPath + " \u2192 " + newRemainingPath + "}";
    } else if (finalSuffix.length) {
      return "{" + oldRemainingPath + " \u2192 " + newRemainingPath + "}" + separator + finalSuffix;
    }
    return oldFilename + " \u2192 " + newFilename;
  } else if (!isDevNullName(newFilename)) {
    return newFilename;
  } else {
    return oldFilename;
  }
}
function getHtmlId(file) {
  return `d2h-${hashCode(filenameDiff(file)).toString().slice(-6)}`;
}
function getFileIcon(file) {
  let templateName = "file-changed";
  if (file.isRename) {
    templateName = "file-renamed";
  } else if (file.isCopy) {
    templateName = "file-renamed";
  } else if (file.isNew) {
    templateName = "file-added";
  } else if (file.isDeleted) {
    templateName = "file-deleted";
  } else if (file.newName !== file.oldName) {
    templateName = "file-renamed";
  }
  return templateName;
}
function diffHighlight(diffLine1, diffLine2, isCombined, config = {}) {
  const { matching, maxLineLengthHighlight, matchWordsThreshold, diffStyle } = Object.assign(Object.assign({}, defaultRenderConfig), config);
  const line1 = deconstructLine(diffLine1, isCombined, false);
  const line2 = deconstructLine(diffLine2, isCombined, false);
  if (line1.content.length > maxLineLengthHighlight || line2.content.length > maxLineLengthHighlight) {
    return {
      oldLine: {
        prefix: line1.prefix,
        content: escapeForHtml(line1.content)
      },
      newLine: {
        prefix: line2.prefix,
        content: escapeForHtml(line2.content)
      }
    };
  }
  const diff = diffStyle === "char" ? diffChars(line1.content, line2.content) : diffWordsWithSpace(line1.content, line2.content);
  const changedWords = [];
  if (diffStyle === "word" && matching === "words") {
    const removed = diff.filter((element) => element.removed);
    const added = diff.filter((element) => element.added);
    const chunks = matcher(added, removed);
    chunks.forEach((chunk) => {
      if (chunk[0].length === 1 && chunk[1].length === 1) {
        const dist = distance(chunk[0][0], chunk[1][0]);
        if (dist < matchWordsThreshold) {
          changedWords.push(chunk[0][0]);
          changedWords.push(chunk[1][0]);
        }
      }
    });
  }
  const highlightedLine = diff.reduce((highlightedLine2, part) => {
    const elemType = part.added ? "ins" : part.removed ? "del" : null;
    const addClass = changedWords.indexOf(part) > -1 ? ' class="d2h-change"' : "";
    const escapedValue = escapeForHtml(part.value);
    return elemType !== null ? `${highlightedLine2}<${elemType}${addClass}>${escapedValue}</${elemType}>` : `${highlightedLine2}${escapedValue}`;
  }, "");
  return {
    oldLine: {
      prefix: line1.prefix,
      content: removeInsElements(highlightedLine)
    },
    newLine: {
      prefix: line2.prefix,
      content: removeDelElements(highlightedLine)
    }
  };
}

// node_modules/diff2html/lib-esm/file-list-renderer.js
var baseTemplatesPath = "file-summary";
var iconsBaseTemplatesPath = "icon";
var defaultFileListRendererConfig = {
  colorScheme: defaultRenderConfig.colorScheme
};
var FileListRenderer = class {
  constructor(hoganUtils, config = {}) {
    this.hoganUtils = hoganUtils;
    this.config = Object.assign(Object.assign({}, defaultFileListRendererConfig), config);
  }
  render(diffFiles) {
    const files = diffFiles.map((file) => this.hoganUtils.render(baseTemplatesPath, "line", {
      fileHtmlId: getHtmlId(file),
      oldName: file.oldName,
      newName: file.newName,
      fileName: filenameDiff(file),
      deletedLines: "-" + file.deletedLines,
      addedLines: "+" + file.addedLines
    }, {
      fileIcon: this.hoganUtils.template(iconsBaseTemplatesPath, getFileIcon(file))
    })).join("\n");
    return this.hoganUtils.render(baseTemplatesPath, "wrapper", {
      colorScheme: colorSchemeToCss(this.config.colorScheme),
      filesNumber: diffFiles.length,
      files
    });
  }
};

// node_modules/diff2html/lib-esm/line-by-line-renderer.js
var defaultLineByLineRendererConfig = Object.assign(Object.assign({}, defaultRenderConfig), { renderNothingWhenEmpty: false, matchingMaxComparisons: 2500, maxLineSizeInBlockForComparison: 200 });
var genericTemplatesPath = "generic";
var baseTemplatesPath2 = "line-by-line";
var iconsBaseTemplatesPath2 = "icon";
var tagsBaseTemplatesPath = "tag";
var LineByLineRenderer = class {
  constructor(hoganUtils, config = {}) {
    this.hoganUtils = hoganUtils;
    this.config = Object.assign(Object.assign({}, defaultLineByLineRendererConfig), config);
  }
  render(diffFiles) {
    const diffsHtml = diffFiles.map((file) => {
      let diffs;
      if (file.blocks.length) {
        diffs = this.generateFileHtml(file);
      } else {
        diffs = this.generateEmptyDiff();
      }
      return this.makeFileDiffHtml(file, diffs);
    }).join("\n");
    return this.hoganUtils.render(genericTemplatesPath, "wrapper", {
      colorScheme: colorSchemeToCss(this.config.colorScheme),
      content: diffsHtml
    });
  }
  makeFileDiffHtml(file, diffs) {
    if (this.config.renderNothingWhenEmpty && Array.isArray(file.blocks) && file.blocks.length === 0)
      return "";
    const fileDiffTemplate = this.hoganUtils.template(baseTemplatesPath2, "file-diff");
    const filePathTemplate = this.hoganUtils.template(genericTemplatesPath, "file-path");
    const fileIconTemplate = this.hoganUtils.template(iconsBaseTemplatesPath2, "file");
    const fileTagTemplate = this.hoganUtils.template(tagsBaseTemplatesPath, getFileIcon(file));
    return fileDiffTemplate.render({
      file,
      fileHtmlId: getHtmlId(file),
      diffs,
      filePath: filePathTemplate.render({
        fileDiffName: filenameDiff(file)
      }, {
        fileIcon: fileIconTemplate,
        fileTag: fileTagTemplate
      })
    });
  }
  generateEmptyDiff() {
    return this.hoganUtils.render(genericTemplatesPath, "empty-diff", {
      contentClass: "d2h-code-line",
      CSSLineClass
    });
  }
  generateFileHtml(file) {
    const matcher2 = newMatcherFn(newDistanceFn((e) => deconstructLine(e.content, file.isCombined).content));
    return file.blocks.map((block) => {
      let lines = this.hoganUtils.render(genericTemplatesPath, "block-header", {
        CSSLineClass,
        blockHeader: file.isTooBig ? block.header : escapeForHtml(block.header),
        lineClass: "d2h-code-linenumber",
        contentClass: "d2h-code-line"
      });
      this.applyLineGroupping(block).forEach(([contextLines, oldLines, newLines]) => {
        if (oldLines.length && newLines.length && !contextLines.length) {
          this.applyRematchMatching(oldLines, newLines, matcher2).map(([oldLines2, newLines2]) => {
            const { left, right } = this.processChangedLines(file, file.isCombined, oldLines2, newLines2);
            lines += left;
            lines += right;
          });
        } else if (contextLines.length) {
          contextLines.forEach((line) => {
            const { prefix, content } = deconstructLine(line.content, file.isCombined);
            lines += this.generateSingleLineHtml(file, {
              type: CSSLineClass.CONTEXT,
              prefix,
              content,
              oldNumber: line.oldNumber,
              newNumber: line.newNumber
            });
          });
        } else if (oldLines.length || newLines.length) {
          const { left, right } = this.processChangedLines(file, file.isCombined, oldLines, newLines);
          lines += left;
          lines += right;
        } else {
          console.error("Unknown state reached while processing groups of lines", contextLines, oldLines, newLines);
        }
      });
      return lines;
    }).join("\n");
  }
  applyLineGroupping(block) {
    const blockLinesGroups = [];
    let oldLines = [];
    let newLines = [];
    for (let i = 0; i < block.lines.length; i++) {
      const diffLine = block.lines[i];
      if (diffLine.type !== LineType.INSERT && newLines.length || diffLine.type === LineType.CONTEXT && oldLines.length > 0) {
        blockLinesGroups.push([[], oldLines, newLines]);
        oldLines = [];
        newLines = [];
      }
      if (diffLine.type === LineType.CONTEXT) {
        blockLinesGroups.push([[diffLine], [], []]);
      } else if (diffLine.type === LineType.INSERT && oldLines.length === 0) {
        blockLinesGroups.push([[], [], [diffLine]]);
      } else if (diffLine.type === LineType.INSERT && oldLines.length > 0) {
        newLines.push(diffLine);
      } else if (diffLine.type === LineType.DELETE) {
        oldLines.push(diffLine);
      }
    }
    if (oldLines.length || newLines.length) {
      blockLinesGroups.push([[], oldLines, newLines]);
      oldLines = [];
      newLines = [];
    }
    return blockLinesGroups;
  }
  applyRematchMatching(oldLines, newLines, matcher2) {
    const comparisons = oldLines.length * newLines.length;
    const maxLineSizeInBlock = max(oldLines.concat(newLines).map((elem) => elem.content.length));
    const doMatching = comparisons < this.config.matchingMaxComparisons && maxLineSizeInBlock < this.config.maxLineSizeInBlockForComparison && (this.config.matching === "lines" || this.config.matching === "words");
    return doMatching ? matcher2(oldLines, newLines) : [[oldLines, newLines]];
  }
  processChangedLines(file, isCombined, oldLines, newLines) {
    const fileHtml = {
      right: "",
      left: ""
    };
    const maxLinesNumber = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLinesNumber; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];
      const diff = oldLine !== void 0 && newLine !== void 0 ? diffHighlight(oldLine.content, newLine.content, isCombined, this.config) : void 0;
      const preparedOldLine = oldLine !== void 0 && oldLine.oldNumber !== void 0 ? Object.assign(Object.assign({}, diff !== void 0 ? {
        prefix: diff.oldLine.prefix,
        content: diff.oldLine.content,
        type: CSSLineClass.DELETE_CHANGES
      } : Object.assign(Object.assign({}, deconstructLine(oldLine.content, isCombined)), { type: toCSSClass(oldLine.type) })), { oldNumber: oldLine.oldNumber, newNumber: oldLine.newNumber }) : void 0;
      const preparedNewLine = newLine !== void 0 && newLine.newNumber !== void 0 ? Object.assign(Object.assign({}, diff !== void 0 ? {
        prefix: diff.newLine.prefix,
        content: diff.newLine.content,
        type: CSSLineClass.INSERT_CHANGES
      } : Object.assign(Object.assign({}, deconstructLine(newLine.content, isCombined)), { type: toCSSClass(newLine.type) })), { oldNumber: newLine.oldNumber, newNumber: newLine.newNumber }) : void 0;
      const { left, right } = this.generateLineHtml(file, preparedOldLine, preparedNewLine);
      fileHtml.left += left;
      fileHtml.right += right;
    }
    return fileHtml;
  }
  generateLineHtml(file, oldLine, newLine) {
    return {
      left: this.generateSingleLineHtml(file, oldLine),
      right: this.generateSingleLineHtml(file, newLine)
    };
  }
  generateSingleLineHtml(file, line) {
    if (line === void 0)
      return "";
    const lineNumberHtml = this.hoganUtils.render(baseTemplatesPath2, "numbers", {
      oldNumber: line.oldNumber || "",
      newNumber: line.newNumber || ""
    });
    return this.hoganUtils.render(genericTemplatesPath, "line", {
      type: line.type,
      lineClass: "d2h-code-linenumber",
      contentClass: "d2h-code-line",
      prefix: line.prefix === " " ? "&nbsp;" : line.prefix,
      content: line.content,
      lineNumber: lineNumberHtml,
      line,
      file
    });
  }
};

// node_modules/diff2html/lib-esm/side-by-side-renderer.js
var defaultSideBySideRendererConfig = Object.assign(Object.assign({}, defaultRenderConfig), { renderNothingWhenEmpty: false, matchingMaxComparisons: 2500, maxLineSizeInBlockForComparison: 200 });
var genericTemplatesPath2 = "generic";
var baseTemplatesPath3 = "side-by-side";
var iconsBaseTemplatesPath3 = "icon";
var tagsBaseTemplatesPath2 = "tag";
var SideBySideRenderer = class {
  constructor(hoganUtils, config = {}) {
    this.hoganUtils = hoganUtils;
    this.config = Object.assign(Object.assign({}, defaultSideBySideRendererConfig), config);
  }
  render(diffFiles) {
    const diffsHtml = diffFiles.map((file) => {
      let diffs;
      if (file.blocks.length) {
        diffs = this.generateFileHtml(file);
      } else {
        diffs = this.generateEmptyDiff();
      }
      return this.makeFileDiffHtml(file, diffs);
    }).join("\n");
    return this.hoganUtils.render(genericTemplatesPath2, "wrapper", {
      colorScheme: colorSchemeToCss(this.config.colorScheme),
      content: diffsHtml
    });
  }
  makeFileDiffHtml(file, diffs) {
    if (this.config.renderNothingWhenEmpty && Array.isArray(file.blocks) && file.blocks.length === 0)
      return "";
    const fileDiffTemplate = this.hoganUtils.template(baseTemplatesPath3, "file-diff");
    const filePathTemplate = this.hoganUtils.template(genericTemplatesPath2, "file-path");
    const fileIconTemplate = this.hoganUtils.template(iconsBaseTemplatesPath3, "file");
    const fileTagTemplate = this.hoganUtils.template(tagsBaseTemplatesPath2, getFileIcon(file));
    return fileDiffTemplate.render({
      file,
      fileHtmlId: getHtmlId(file),
      diffs,
      filePath: filePathTemplate.render({
        fileDiffName: filenameDiff(file)
      }, {
        fileIcon: fileIconTemplate,
        fileTag: fileTagTemplate
      })
    });
  }
  generateEmptyDiff() {
    return {
      right: "",
      left: this.hoganUtils.render(genericTemplatesPath2, "empty-diff", {
        contentClass: "d2h-code-side-line",
        CSSLineClass
      })
    };
  }
  generateFileHtml(file) {
    const matcher2 = newMatcherFn(newDistanceFn((e) => deconstructLine(e.content, file.isCombined).content));
    return file.blocks.map((block) => {
      const fileHtml = {
        left: this.makeHeaderHtml(block.header, file),
        right: this.makeHeaderHtml("")
      };
      this.applyLineGroupping(block).forEach(([contextLines, oldLines, newLines]) => {
        if (oldLines.length && newLines.length && !contextLines.length) {
          this.applyRematchMatching(oldLines, newLines, matcher2).map(([oldLines2, newLines2]) => {
            const { left, right } = this.processChangedLines(file.isCombined, oldLines2, newLines2);
            fileHtml.left += left;
            fileHtml.right += right;
          });
        } else if (contextLines.length) {
          contextLines.forEach((line) => {
            const { prefix, content } = deconstructLine(line.content, file.isCombined);
            const { left, right } = this.generateLineHtml({
              type: CSSLineClass.CONTEXT,
              prefix,
              content,
              number: line.oldNumber
            }, {
              type: CSSLineClass.CONTEXT,
              prefix,
              content,
              number: line.newNumber
            });
            fileHtml.left += left;
            fileHtml.right += right;
          });
        } else if (oldLines.length || newLines.length) {
          const { left, right } = this.processChangedLines(file.isCombined, oldLines, newLines);
          fileHtml.left += left;
          fileHtml.right += right;
        } else {
          console.error("Unknown state reached while processing groups of lines", contextLines, oldLines, newLines);
        }
      });
      return fileHtml;
    }).reduce((accomulated, html2) => {
      return { left: accomulated.left + html2.left, right: accomulated.right + html2.right };
    }, { left: "", right: "" });
  }
  applyLineGroupping(block) {
    const blockLinesGroups = [];
    let oldLines = [];
    let newLines = [];
    for (let i = 0; i < block.lines.length; i++) {
      const diffLine = block.lines[i];
      if (diffLine.type !== LineType.INSERT && newLines.length || diffLine.type === LineType.CONTEXT && oldLines.length > 0) {
        blockLinesGroups.push([[], oldLines, newLines]);
        oldLines = [];
        newLines = [];
      }
      if (diffLine.type === LineType.CONTEXT) {
        blockLinesGroups.push([[diffLine], [], []]);
      } else if (diffLine.type === LineType.INSERT && oldLines.length === 0) {
        blockLinesGroups.push([[], [], [diffLine]]);
      } else if (diffLine.type === LineType.INSERT && oldLines.length > 0) {
        newLines.push(diffLine);
      } else if (diffLine.type === LineType.DELETE) {
        oldLines.push(diffLine);
      }
    }
    if (oldLines.length || newLines.length) {
      blockLinesGroups.push([[], oldLines, newLines]);
      oldLines = [];
      newLines = [];
    }
    return blockLinesGroups;
  }
  applyRematchMatching(oldLines, newLines, matcher2) {
    const comparisons = oldLines.length * newLines.length;
    const maxLineSizeInBlock = max(oldLines.concat(newLines).map((elem) => elem.content.length));
    const doMatching = comparisons < this.config.matchingMaxComparisons && maxLineSizeInBlock < this.config.maxLineSizeInBlockForComparison && (this.config.matching === "lines" || this.config.matching === "words");
    return doMatching ? matcher2(oldLines, newLines) : [[oldLines, newLines]];
  }
  makeHeaderHtml(blockHeader, file) {
    return this.hoganUtils.render(genericTemplatesPath2, "block-header", {
      CSSLineClass,
      blockHeader: (file === null || file === void 0 ? void 0 : file.isTooBig) ? blockHeader : escapeForHtml(blockHeader),
      lineClass: "d2h-code-side-linenumber",
      contentClass: "d2h-code-side-line"
    });
  }
  processChangedLines(isCombined, oldLines, newLines) {
    const fileHtml = {
      right: "",
      left: ""
    };
    const maxLinesNumber = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLinesNumber; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];
      const diff = oldLine !== void 0 && newLine !== void 0 ? diffHighlight(oldLine.content, newLine.content, isCombined, this.config) : void 0;
      const preparedOldLine = oldLine !== void 0 && oldLine.oldNumber !== void 0 ? Object.assign(Object.assign({}, diff !== void 0 ? {
        prefix: diff.oldLine.prefix,
        content: diff.oldLine.content,
        type: CSSLineClass.DELETE_CHANGES
      } : Object.assign(Object.assign({}, deconstructLine(oldLine.content, isCombined)), { type: toCSSClass(oldLine.type) })), { number: oldLine.oldNumber }) : void 0;
      const preparedNewLine = newLine !== void 0 && newLine.newNumber !== void 0 ? Object.assign(Object.assign({}, diff !== void 0 ? {
        prefix: diff.newLine.prefix,
        content: diff.newLine.content,
        type: CSSLineClass.INSERT_CHANGES
      } : Object.assign(Object.assign({}, deconstructLine(newLine.content, isCombined)), { type: toCSSClass(newLine.type) })), { number: newLine.newNumber }) : void 0;
      const { left, right } = this.generateLineHtml(preparedOldLine, preparedNewLine);
      fileHtml.left += left;
      fileHtml.right += right;
    }
    return fileHtml;
  }
  generateLineHtml(oldLine, newLine) {
    return {
      left: this.generateSingleHtml(oldLine),
      right: this.generateSingleHtml(newLine)
    };
  }
  generateSingleHtml(line) {
    const lineClass = "d2h-code-side-linenumber";
    const contentClass = "d2h-code-side-line";
    return this.hoganUtils.render(genericTemplatesPath2, "line", {
      type: (line === null || line === void 0 ? void 0 : line.type) || `${CSSLineClass.CONTEXT} d2h-emptyplaceholder`,
      lineClass: line !== void 0 ? lineClass : `${lineClass} d2h-code-side-emptyplaceholder`,
      contentClass: line !== void 0 ? contentClass : `${contentClass} d2h-code-side-emptyplaceholder`,
      prefix: (line === null || line === void 0 ? void 0 : line.prefix) === " " ? "&nbsp;" : line === null || line === void 0 ? void 0 : line.prefix,
      content: line === null || line === void 0 ? void 0 : line.content,
      lineNumber: line === null || line === void 0 ? void 0 : line.number
    });
  }
};

// node_modules/diff2html/lib-esm/hoganjs-utils.js
var Hogan3 = __toESM(require_hogan());

// node_modules/diff2html/lib-esm/diff2html-templates.js
var Hogan2 = __toESM(require_hogan());
var defaultTemplates = {};
defaultTemplates["file-summary-line"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<li class="d2h-file-list-line">');
  t.b("\n" + i);
  t.b('    <span class="d2h-file-name-wrapper">');
  t.b("\n" + i);
  t.b(t.rp("<fileIcon0", c, p, "      "));
  t.b('      <a href="#');
  t.b(t.v(t.f("fileHtmlId", c, p, 0)));
  t.b('" class="d2h-file-name">');
  t.b(t.v(t.f("fileName", c, p, 0)));
  t.b("</a>");
  t.b("\n" + i);
  t.b('      <span class="d2h-file-stats">');
  t.b("\n" + i);
  t.b('          <span class="d2h-lines-added">');
  t.b(t.v(t.f("addedLines", c, p, 0)));
  t.b("</span>");
  t.b("\n" + i);
  t.b('          <span class="d2h-lines-deleted">');
  t.b(t.v(t.f("deletedLines", c, p, 0)));
  t.b("</span>");
  t.b("\n" + i);
  t.b("      </span>");
  t.b("\n" + i);
  t.b("    </span>");
  t.b("\n" + i);
  t.b("</li>");
  return t.fl();
}, partials: { "<fileIcon0": { name: "fileIcon", partials: {}, subs: {} } }, subs: {} });
defaultTemplates["file-summary-wrapper"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<div class="d2h-file-list-wrapper ');
  t.b(t.v(t.f("colorScheme", c, p, 0)));
  t.b('">');
  t.b("\n" + i);
  t.b('    <div class="d2h-file-list-header">');
  t.b("\n" + i);
  t.b('        <span class="d2h-file-list-title">Files changed (');
  t.b(t.v(t.f("filesNumber", c, p, 0)));
  t.b(")</span>");
  t.b("\n" + i);
  t.b('        <a class="d2h-file-switch d2h-hide">hide</a>');
  t.b("\n" + i);
  t.b('        <a class="d2h-file-switch d2h-show">show</a>');
  t.b("\n" + i);
  t.b("    </div>");
  t.b("\n" + i);
  t.b('    <ol class="d2h-file-list">');
  t.b("\n" + i);
  t.b("    ");
  t.b(t.t(t.f("files", c, p, 0)));
  t.b("\n" + i);
  t.b("    </ol>");
  t.b("\n" + i);
  t.b("</div>");
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["generic-block-header"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b("<tr>");
  t.b("\n" + i);
  t.b('    <td class="');
  t.b(t.v(t.f("lineClass", c, p, 0)));
  t.b(" ");
  t.b(t.v(t.d("CSSLineClass.INFO", c, p, 0)));
  t.b('"></td>');
  t.b("\n" + i);
  t.b('    <td class="');
  t.b(t.v(t.d("CSSLineClass.INFO", c, p, 0)));
  t.b('">');
  t.b("\n" + i);
  t.b('        <div class="');
  t.b(t.v(t.f("contentClass", c, p, 0)));
  t.b('">');
  if (t.s(t.f("blockHeader", c, p, 1), c, p, 0, 156, 173, "{{ }}")) {
    t.rs(c, p, function(c2, p2, t2) {
      t2.b(t2.t(t2.f("blockHeader", c2, p2, 0)));
    });
    c.pop();
  }
  if (!t.s(t.f("blockHeader", c, p, 1), c, p, 1, 0, 0, "")) {
    t.b("&nbsp;");
  }
  ;
  t.b("</div>");
  t.b("\n" + i);
  t.b("    </td>");
  t.b("\n" + i);
  t.b("</tr>");
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["generic-empty-diff"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b("<tr>");
  t.b("\n" + i);
  t.b('    <td class="');
  t.b(t.v(t.d("CSSLineClass.INFO", c, p, 0)));
  t.b('">');
  t.b("\n" + i);
  t.b('        <div class="');
  t.b(t.v(t.f("contentClass", c, p, 0)));
  t.b('">');
  t.b("\n" + i);
  t.b("            File without changes");
  t.b("\n" + i);
  t.b("        </div>");
  t.b("\n" + i);
  t.b("    </td>");
  t.b("\n" + i);
  t.b("</tr>");
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["generic-file-path"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<span class="d2h-file-name-wrapper">');
  t.b("\n" + i);
  t.b(t.rp("<fileIcon0", c, p, "    "));
  t.b('    <span class="d2h-file-name">');
  t.b(t.v(t.f("fileDiffName", c, p, 0)));
  t.b("</span>");
  t.b("\n" + i);
  t.b(t.rp("<fileTag1", c, p, "    "));
  t.b("</span>");
  t.b("\n" + i);
  t.b('<label class="d2h-file-collapse">');
  t.b("\n" + i);
  t.b('    <input class="d2h-file-collapse-input" type="checkbox" name="viewed" value="viewed">');
  t.b("\n" + i);
  t.b("    Viewed");
  t.b("\n" + i);
  t.b("</label>");
  return t.fl();
}, partials: { "<fileIcon0": { name: "fileIcon", partials: {}, subs: {} }, "<fileTag1": { name: "fileTag", partials: {}, subs: {} } }, subs: {} });
defaultTemplates["generic-line"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b("<tr>");
  t.b("\n" + i);
  t.b('    <td class="');
  t.b(t.v(t.f("lineClass", c, p, 0)));
  t.b(" ");
  t.b(t.v(t.f("type", c, p, 0)));
  t.b('">');
  t.b("\n" + i);
  t.b("      ");
  t.b(t.t(t.f("lineNumber", c, p, 0)));
  t.b("\n" + i);
  t.b("    </td>");
  t.b("\n" + i);
  t.b('    <td class="');
  t.b(t.v(t.f("type", c, p, 0)));
  t.b('">');
  t.b("\n" + i);
  t.b('        <div class="');
  t.b(t.v(t.f("contentClass", c, p, 0)));
  t.b('">');
  t.b("\n" + i);
  if (t.s(t.f("prefix", c, p, 1), c, p, 0, 162, 238, "{{ }}")) {
    t.rs(c, p, function(c2, p2, t2) {
      t2.b('            <span class="d2h-code-line-prefix">');
      t2.b(t2.t(t2.f("prefix", c2, p2, 0)));
      t2.b("</span>");
      t2.b("\n" + i);
    });
    c.pop();
  }
  if (!t.s(t.f("prefix", c, p, 1), c, p, 1, 0, 0, "")) {
    t.b('            <span class="d2h-code-line-prefix">&nbsp;</span>');
    t.b("\n" + i);
  }
  ;
  if (t.s(t.f("content", c, p, 1), c, p, 0, 371, 445, "{{ }}")) {
    t.rs(c, p, function(c2, p2, t2) {
      t2.b('            <span class="d2h-code-line-ctn">');
      t2.b(t2.t(t2.f("content", c2, p2, 0)));
      t2.b("</span>");
      t2.b("\n" + i);
    });
    c.pop();
  }
  if (!t.s(t.f("content", c, p, 1), c, p, 1, 0, 0, "")) {
    t.b('            <span class="d2h-code-line-ctn"><br></span>');
    t.b("\n" + i);
  }
  ;
  t.b("        </div>");
  t.b("\n" + i);
  t.b("    </td>");
  t.b("\n" + i);
  t.b("</tr>");
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["generic-wrapper"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<div class="d2h-wrapper ');
  t.b(t.v(t.f("colorScheme", c, p, 0)));
  t.b('">');
  t.b("\n" + i);
  t.b("    ");
  t.b(t.t(t.f("content", c, p, 0)));
  t.b("\n" + i);
  t.b("</div>");
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["icon-file-added"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<svg aria-hidden="true" class="d2h-icon d2h-added" height="16" title="added" version="1.1" viewBox="0 0 14 16"');
  t.b("\n" + i);
  t.b('     width="14">');
  t.b("\n" + i);
  t.b('    <path d="M13 1H1C0.45 1 0 1.45 0 2v12c0 0.55 0.45 1 1 1h12c0.55 0 1-0.45 1-1V2c0-0.55-0.45-1-1-1z m0 13H1V2h12v12zM6 9H3V7h3V4h2v3h3v2H8v3H6V9z"></path>');
  t.b("\n" + i);
  t.b("</svg>");
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["icon-file-changed"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<svg aria-hidden="true" class="d2h-icon d2h-changed" height="16" title="modified" version="1.1"');
  t.b("\n" + i);
  t.b('     viewBox="0 0 14 16" width="14">');
  t.b("\n" + i);
  t.b('    <path d="M13 1H1C0.45 1 0 1.45 0 2v12c0 0.55 0.45 1 1 1h12c0.55 0 1-0.45 1-1V2c0-0.55-0.45-1-1-1z m0 13H1V2h12v12zM4 8c0-1.66 1.34-3 3-3s3 1.34 3 3-1.34 3-3 3-3-1.34-3-3z"></path>');
  t.b("\n" + i);
  t.b("</svg>");
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["icon-file-deleted"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<svg aria-hidden="true" class="d2h-icon d2h-deleted" height="16" title="removed" version="1.1"');
  t.b("\n" + i);
  t.b('     viewBox="0 0 14 16" width="14">');
  t.b("\n" + i);
  t.b('    <path d="M13 1H1C0.45 1 0 1.45 0 2v12c0 0.55 0.45 1 1 1h12c0.55 0 1-0.45 1-1V2c0-0.55-0.45-1-1-1z m0 13H1V2h12v12zM11 9H3V7h8v2z"></path>');
  t.b("\n" + i);
  t.b("</svg>");
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["icon-file-renamed"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<svg aria-hidden="true" class="d2h-icon d2h-moved" height="16" title="renamed" version="1.1"');
  t.b("\n" + i);
  t.b('     viewBox="0 0 14 16" width="14">');
  t.b("\n" + i);
  t.b('    <path d="M6 9H3V7h3V4l5 4-5 4V9z m8-7v12c0 0.55-0.45 1-1 1H1c-0.55 0-1-0.45-1-1V2c0-0.55 0.45-1 1-1h12c0.55 0 1 0.45 1 1z m-1 0H1v12h12V2z"></path>');
  t.b("\n" + i);
  t.b("</svg>");
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["icon-file"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<svg aria-hidden="true" class="d2h-icon" height="16" version="1.1" viewBox="0 0 12 16" width="12">');
  t.b("\n" + i);
  t.b('    <path d="M6 5H2v-1h4v1zM2 8h7v-1H2v1z m0 2h7v-1H2v1z m0 2h7v-1H2v1z m10-7.5v9.5c0 0.55-0.45 1-1 1H1c-0.55 0-1-0.45-1-1V2c0-0.55 0.45-1 1-1h7.5l3.5 3.5z m-1 0.5L8 2H1v12h10V5z"></path>');
  t.b("\n" + i);
  t.b("</svg>");
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["line-by-line-file-diff"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<div id="');
  t.b(t.v(t.f("fileHtmlId", c, p, 0)));
  t.b('" class="d2h-file-wrapper" data-lang="');
  t.b(t.v(t.d("file.language", c, p, 0)));
  t.b('">');
  t.b("\n" + i);
  t.b('    <div class="d2h-file-header">');
  t.b("\n" + i);
  t.b("    ");
  t.b(t.t(t.f("filePath", c, p, 0)));
  t.b("\n" + i);
  t.b("    </div>");
  t.b("\n" + i);
  t.b('    <div class="d2h-file-diff">');
  t.b("\n" + i);
  t.b('        <div class="d2h-code-wrapper">');
  t.b("\n" + i);
  t.b('            <table class="d2h-diff-table">');
  t.b("\n" + i);
  t.b('                <tbody class="d2h-diff-tbody">');
  t.b("\n" + i);
  t.b("                ");
  t.b(t.t(t.f("diffs", c, p, 0)));
  t.b("\n" + i);
  t.b("                </tbody>");
  t.b("\n" + i);
  t.b("            </table>");
  t.b("\n" + i);
  t.b("        </div>");
  t.b("\n" + i);
  t.b("    </div>");
  t.b("\n" + i);
  t.b("</div>");
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["line-by-line-numbers"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<div class="line-num1">');
  t.b(t.v(t.f("oldNumber", c, p, 0)));
  t.b("</div>");
  t.b("\n" + i);
  t.b('<div class="line-num2">');
  t.b(t.v(t.f("newNumber", c, p, 0)));
  t.b("</div>");
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["side-by-side-file-diff"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<div id="');
  t.b(t.v(t.f("fileHtmlId", c, p, 0)));
  t.b('" class="d2h-file-wrapper" data-lang="');
  t.b(t.v(t.d("file.language", c, p, 0)));
  t.b('">');
  t.b("\n" + i);
  t.b('    <div class="d2h-file-header">');
  t.b("\n" + i);
  t.b("      ");
  t.b(t.t(t.f("filePath", c, p, 0)));
  t.b("\n" + i);
  t.b("    </div>");
  t.b("\n" + i);
  t.b('    <div class="d2h-files-diff">');
  t.b("\n" + i);
  t.b('        <div class="d2h-file-side-diff">');
  t.b("\n" + i);
  t.b('            <div class="d2h-code-wrapper">');
  t.b("\n" + i);
  t.b('                <table class="d2h-diff-table">');
  t.b("\n" + i);
  t.b('                    <tbody class="d2h-diff-tbody">');
  t.b("\n" + i);
  t.b("                    ");
  t.b(t.t(t.d("diffs.left", c, p, 0)));
  t.b("\n" + i);
  t.b("                    </tbody>");
  t.b("\n" + i);
  t.b("                </table>");
  t.b("\n" + i);
  t.b("            </div>");
  t.b("\n" + i);
  t.b("        </div>");
  t.b("\n" + i);
  t.b('        <div class="d2h-file-side-diff">');
  t.b("\n" + i);
  t.b('            <div class="d2h-code-wrapper">');
  t.b("\n" + i);
  t.b('                <table class="d2h-diff-table">');
  t.b("\n" + i);
  t.b('                    <tbody class="d2h-diff-tbody">');
  t.b("\n" + i);
  t.b("                    ");
  t.b(t.t(t.d("diffs.right", c, p, 0)));
  t.b("\n" + i);
  t.b("                    </tbody>");
  t.b("\n" + i);
  t.b("                </table>");
  t.b("\n" + i);
  t.b("            </div>");
  t.b("\n" + i);
  t.b("        </div>");
  t.b("\n" + i);
  t.b("    </div>");
  t.b("\n" + i);
  t.b("</div>");
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["tag-file-added"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<span class="d2h-tag d2h-added d2h-added-tag">ADDED</span>');
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["tag-file-changed"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<span class="d2h-tag d2h-changed d2h-changed-tag">CHANGED</span>');
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["tag-file-deleted"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<span class="d2h-tag d2h-deleted d2h-deleted-tag">DELETED</span>');
  return t.fl();
}, partials: {}, subs: {} });
defaultTemplates["tag-file-renamed"] = new Hogan2.Template({ code: function(c, p, i) {
  var t = this;
  t.b(i = i || "");
  t.b('<span class="d2h-tag d2h-moved d2h-moved-tag">RENAMED</span>');
  return t.fl();
}, partials: {}, subs: {} });

// node_modules/diff2html/lib-esm/hoganjs-utils.js
var HoganJsUtils = class {
  constructor({ compiledTemplates = {}, rawTemplates = {} }) {
    const compiledRawTemplates = Object.entries(rawTemplates).reduce((previousTemplates, [name, templateString]) => {
      const compiledTemplate = Hogan3.compile(templateString, { asString: false });
      return Object.assign(Object.assign({}, previousTemplates), { [name]: compiledTemplate });
    }, {});
    this.preCompiledTemplates = Object.assign(Object.assign(Object.assign({}, defaultTemplates), compiledTemplates), compiledRawTemplates);
  }
  static compile(templateString) {
    return Hogan3.compile(templateString, { asString: false });
  }
  render(namespace, view, params, partials, indent) {
    const templateKey = this.templateKey(namespace, view);
    try {
      const template = this.preCompiledTemplates[templateKey];
      return template.render(params, partials, indent);
    } catch (_e) {
      throw new Error(`Could not find template to render '${templateKey}'`);
    }
  }
  template(namespace, view) {
    return this.preCompiledTemplates[this.templateKey(namespace, view)];
  }
  templateKey(namespace, view) {
    return `${namespace}-${view}`;
  }
};

// node_modules/diff2html/lib-esm/diff2html.js
var defaultDiff2HtmlConfig = Object.assign(Object.assign(Object.assign({}, defaultLineByLineRendererConfig), defaultSideBySideRendererConfig), { outputFormat: OutputFormatType.LINE_BY_LINE, drawFileList: true });
function html(diffInput, configuration = {}) {
  const config = Object.assign(Object.assign({}, defaultDiff2HtmlConfig), configuration);
  const diffJson = typeof diffInput === "string" ? parse(diffInput, config) : diffInput;
  const hoganUtils = new HoganJsUtils(config);
  const { colorScheme } = config;
  const fileListRendererConfig = { colorScheme };
  const fileList = config.drawFileList ? new FileListRenderer(hoganUtils, fileListRendererConfig).render(diffJson) : "";
  const diffOutput = config.outputFormat === "side-by-side" ? new SideBySideRenderer(hoganUtils, config).render(diffJson) : new LineByLineRenderer(hoganUtils, config).render(diffJson);
  return fileList + diffOutput;
}

// src/ui/DiffView.ts
var NGB_DIFF_VIEW = "native-git-bridge-diff";
function markInvisibles(root, selector = ".d2h-code-line-ctn") {
  for (const ctn of Array.from(root.querySelectorAll(selector))) {
    if (ctn.querySelector(".ngb-ws-glyph")) continue;
    const walker = ctn.ownerDocument.createTreeWalker(ctn, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) textNodes.push(n);
    for (const node of textNodes) {
      const text = node.nodeValue ?? "";
      if (!/[ \t\r]/.test(text)) continue;
      const frag = ctn.ownerDocument.createDocumentFragment();
      for (const part of text.split(/([ \t\r]+)/)) {
        if (part === "") continue;
        if (/^[ \t\r]+$/.test(part)) {
          const span = ctn.ownerDocument.createElement("span");
          span.className = "ngb-ws-glyph";
          span.textContent = part.replace(/ /g, "\xB7").replace(/\t/g, "\u2192").replace(/\r/g, "\u240D");
          frag.appendChild(span);
        } else {
          frag.appendChild(ctn.ownerDocument.createTextNode(part));
        }
      }
      node.replaceWith(frag);
    }
  }
}
function gutterWidthCh(root) {
  let digits = 1;
  for (const el of Array.from(root.querySelectorAll(".line-num1, .line-num2"))) {
    const t = (el.textContent ?? "").trim();
    if (t.length > digits) digits = t.length;
  }
  return 2 * digits + 4;
}
function sizeGutter(box) {
  const host = box.closest(".ngb-diff-view") ?? box;
  host.style.setProperty("--ngb-diff-gutter-w", `${gutterWidthCh(box)}ch`);
}
var DiffView = class extends import_obsidian12.ItemView {
  constructor(leaf, actions) {
    super(leaf);
    this.actions = actions;
    this.state = null;
    /** Guards against a stale fetch rendering over a newer one. */
    this.loadSeq = 0;
    /** Last fetched diff, cached so display toggles re-render without a Termux round trip. */
    this.lastResult = null;
    this.navigation = true;
  }
  getViewType() {
    return NGB_DIFF_VIEW;
  }
  getDisplayText() {
    if (!this.state) return "Diff";
    const base = this.state.path.split("/").pop() ?? this.state.path;
    return `Diff: ${base}`;
  }
  getIcon() {
    return "file-diff";
  }
  getState() {
    return { ...this.state ?? {} };
  }
  async setState(state, result) {
    const s = state;
    if (s && typeof s.path === "string" && typeof s.from === "string" && typeof s.to === "string") {
      this.state = {
        path: s.path,
        from: s.from,
        to: s.to,
        label: typeof s.label === "string" ? s.label : `${s.from} \u2192 ${s.to}`
      };
      await this.loadAndRender();
    }
    return super.setState(state, result);
  }
  async loadAndRender() {
    const st = this.state;
    if (!st) return;
    const seq = ++this.loadSeq;
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-diff-view");
    const head = c.createDiv({ cls: "ngb-pane-path", text: `${st.path} \xB7 ${st.label}` });
    head.setAttribute("aria-label", `${st.path} \xB7 ${st.label}`);
    const box = c.createDiv({ cls: "ngb-diff-pane-body" });
    this.renderWaiting(box.createDiv({ cls: "ngb-filehist-waiting" }));
    const res = await this.actions.loadDiff(st.path, st.from, st.to);
    if (seq !== this.loadSeq) return;
    this.lastResult = res;
    this.renderBody(box, res);
  }
  /** "The runner is working" indicator, identical to the file-history panel's. */
  renderWaiting(el) {
    const spin = el.createSpan({ cls: "ngb-anim-spin ngb-sv-icon-active" });
    (0, import_obsidian12.setIcon)(spin, "refresh-cw");
    const text = el.createSpan({ cls: "ngb-settings-note" });
    const tick = () => {
      const p = this.actions.progressText();
      text.setText(p === "" ? "Loading diff\u2026" : p);
    };
    tick();
    this.registerInterval(window.setInterval(tick, 500));
  }
  renderBody(box, res) {
    this.contentEl.toggleClass("ngb-diff-wrap", this.actions.wrapLines());
    box.empty();
    if (res === null) {
      box.createEl("p", { cls: "ngb-warning", text: "Could not load the diff (see the error message)." });
      return;
    }
    if (res.diff.trim() === "") {
      box.createEl("p", { cls: "ngb-ok", text: "No differences." });
      return;
    }
    const rendered = html(res.diff, {
      drawFileList: false,
      diffStyle: "char",
      outputFormat: "line-by-line"
    });
    box.appendChild((0, import_obsidian12.sanitizeHTMLToDom)(rendered));
    for (const tr of Array.from(box.querySelectorAll("tr"))) {
      const gutter = tr.querySelector(".d2h-code-linenumber");
      const prefix = tr.querySelector(".d2h-code-line-prefix");
      if (gutter && prefix) gutter.appendChild(prefix);
    }
    sizeGutter(box);
    if (res.truncated) {
      box.createDiv({
        cls: "ngb-warning",
        text: "Diff truncated (too large). The full diff is available via git in Termux."
      });
    }
    this.applyDisplayPrefs();
  }
  /**
   * Apply the display preferences to whatever is currently rendered. Kept
   * separate from rendering and idempotent, because the pane is REUSED for
   * every diff: a single "apply once, right after building the DOM" step
   * silently lost the glyphs whenever a later render, a re-attach or a
   * layout change replaced or re-measured that DOM.
   */
  applyDisplayPrefs() {
    this.contentEl.toggleClass("ngb-diff-wrap", this.actions.wrapLines());
    const box = this.contentEl.querySelector(".ngb-diff-pane-body");
    if (!box) return;
    const wanted = this.actions.showInvisibles();
    const present = box.querySelector(".ngb-ws-glyph") !== null;
    if (wanted && !present) markInvisibles(box);
    else if (!wanted && present) this.renderBody(box, this.lastResult);
    else sizeGutter(box);
    this.applyColors();
  }
  /**
   * Custom colours (shared preference, off by default) are written as inline
   * CSS variables on the pane, which is the only way to beat the stylesheet's
   * own defaults on the same element. Turning the toggle off removes them, so
   * the theme takes over again with no reload.
   */
  applyColors() {
    const c = this.actions.colors();
    for (const name of DIFF_COLOR_VARS) {
      if (c && c[name]) this.contentEl.style.setProperty(name, c[name]);
      else this.contentEl.style.removeProperty(name);
    }
  }
  /** Re-render from the cached diff when a display preference changed. */
  refreshDisplay() {
    const box = this.contentEl.querySelector(".ngb-diff-pane-body");
    if (box) this.renderBody(box, this.lastResult);
    else this.applyDisplayPrefs();
  }
  /**
   * Obsidian calls this whenever the pane's size changes, including the first
   * time a reused pane becomes visible at its real width. Re-applying here is
   * what keeps wrapped lines inside the pane instead of measuring against the
   * width some earlier diff happened to be rendered at.
   */
  onResize() {
    this.applyDisplayPrefs();
  }
  async onOpen() {
    if (!this.state) {
      this.contentEl.createEl("p", { cls: "ngb-settings-note", text: "No diff selected." });
      return;
    }
    this.applyDisplayPrefs();
  }
};

// src/ui/ConflictView.ts
var import_obsidian13 = require("obsidian");

// src/git/conflictParser.ts
function markerLabel(line, marker) {
  if (line.startsWith(marker)) return line.slice(marker.length).trim();
  if (line.startsWith("-" + marker)) return line.slice(marker.length + 1).trim();
  return null;
}
var isDivider = (l) => l === "=======" || l === "-=======";
function parseConflictFile(content) {
  const lines = content.split("\n");
  const segments = [];
  let plain = [];
  let conflictCount = 0;
  let i = 0;
  const flushPlain = () => {
    if (plain.length > 0) {
      segments.push({ kind: "text", lines: plain });
      plain = [];
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    const oursLabel = markerLabel(line, "<<<<<<<");
    if (oursLabel !== null) {
      const block = tryParseBlock(lines, i);
      if (block !== null) {
        flushPlain();
        segments.push({
          kind: "conflict",
          index: segments.length,
          oursLabel,
          theirsLabel: block.theirsLabel,
          ours: block.ours,
          theirs: block.theirs,
          base: block.base
        });
        conflictCount++;
        i = block.end + 1;
        continue;
      }
    }
    plain.push(line);
    i++;
  }
  flushPlain();
  return { segments, conflictCount };
}
function tryParseBlock(lines, start) {
  const ours = [];
  const base = [];
  const theirs = [];
  let mode = "ours";
  let sawBase = false;
  for (let j = start + 1; j < lines.length; j++) {
    const l = lines[j];
    const closeLabel = markerLabel(l, ">>>>>>>");
    if (mode === "ours" && markerLabel(l, "|||||||") !== null) {
      mode = "base";
      sawBase = true;
    } else if ((mode === "ours" || mode === "base") && isDivider(l)) {
      mode = "theirs";
    } else if (mode === "theirs" && closeLabel !== null) {
      return { ours, theirs, base: sawBase ? base : void 0, theirsLabel: closeLabel, end: j };
    } else if (markerLabel(l, "<<<<<<<") !== null) {
      return null;
    } else {
      (mode === "ours" ? ours : mode === "base" ? base : theirs).push(l);
    }
  }
  return null;
}
function resolveBlock(parsed, blockIndex, side) {
  const out = [];
  for (const seg of parsed.segments) {
    if (seg.kind === "text") {
      out.push(...seg.lines);
    } else if (seg.index === blockIndex) {
      out.push(...side === "ours" ? seg.ours : seg.theirs);
    } else {
      out.push(`-<<<<<<< ${seg.oursLabel}`);
      out.push(...seg.ours);
      if (seg.base !== void 0) {
        out.push("-||||||| (base)");
        out.push(...seg.base);
      }
      out.push("-=======");
      out.push(...seg.theirs);
      out.push(`->>>>>>> ${seg.theirsLabel}`);
    }
  }
  return out.join("\n");
}

// src/ui/ConflictView.ts
var NGB_CONFLICT_VIEW = "native-git-bridge-conflict";
var ConflictView = class extends import_obsidian13.ItemView {
  constructor(leaf, actions) {
    super(leaf);
    this.actions = actions;
    this.path = null;
    /** Content as last read; guards against clobbering outside edits. */
    this.originalText = null;
    this.parsed = null;
    this.loadSeq = 0;
    this.navigation = true;
  }
  /** Path this pane is resolving (whole-file resolution closes matching panes). */
  get filePath() {
    return this.path;
  }
  getViewType() {
    return NGB_CONFLICT_VIEW;
  }
  getDisplayText() {
    const base = this.path?.split("/").pop();
    return base ? `Conflict: ${base}` : "Conflict";
  }
  getIcon() {
    return "alert-triangle";
  }
  getState() {
    return { path: this.path };
  }
  async setState(state, result) {
    const s = state;
    if (s && typeof s.path === "string") {
      this.path = s.path;
      await this.reload();
    }
    return super.setState(state, result);
  }
  /**
   * Custom colours (shared preference, off by default) as inline CSS
   * variables — the only way to beat the stylesheet's defaults on the same
   * element. Removing them hands the pane back to the theme, no reload needed.
   */
  applyColors() {
    const c = this.actions.colors();
    for (const name of CONFLICT_COLOR_VARS) {
      if (c && c[name]) this.contentEl.style.setProperty(name, c[name]);
      else this.contentEl.style.removeProperty(name);
    }
  }
  async reload() {
    const path = this.path;
    if (path === null) return;
    const seq = ++this.loadSeq;
    const text = await this.actions.readFile(path);
    if (seq !== this.loadSeq) return;
    this.originalText = text;
    this.parsed = text === null ? null : parseConflictFile(text);
    this.render();
  }
  render() {
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-conflict-view");
    this.applyColors();
    const path = this.path;
    if (path === null) {
      c.createEl("p", { cls: "ngb-settings-note", text: "No file selected." });
      return;
    }
    const head = c.createDiv({ cls: "ngb-pane-path", text: path });
    head.setAttribute("aria-label", path);
    if (this.originalText === null || this.parsed === null) {
      c.createEl("p", {
        cls: "ngb-warning",
        text: "This file cannot be shown here (binary or unreadable). Use the file's context menu: keep ours / keep theirs / open in the default app."
      });
      return;
    }
    if (this.parsed.conflictCount === 0) {
      c.createEl("p", { cls: "ngb-ok", text: "No conflict markers left in this file." });
      const btns = c.createDiv({ cls: "ngb-buttons" });
      const stage = btns.createEl("button", { text: "Mark resolved (stage this file)", cls: "mod-cta" });
      stage.addEventListener("click", () => {
        void (async () => {
          await this.actions.stageFile(path);
          new import_obsidian13.Notice("Marked resolved.");
          this.leaf.detach();
        })();
      });
      return;
    }
    c.createEl("p", {
      cls: "ngb-settings-note",
      text: `${this.parsed.conflictCount} conflict${this.parsed.conflictCount === 1 ? "" : "s"} \u2014 pick a side per block. Other lines stay untouched.`
    });
    const list = c.createDiv({ cls: "ngb-conf-list" });
    const rawMarkers = this.actions.markersVisible();
    let lineNo = 1;
    const row = (num, text, cls) => {
      const r = list.createDiv({ cls: `ngb-conf-row ${cls}` });
      r.createSpan({ cls: "ngb-conf-num", text: num === null ? "" : String(num) });
      r.createSpan({ cls: "ngb-conf-text", text: text === "" ? " " : text });
      return r;
    };
    const chromeRow = (num, chip, sideCls, btnLabel, onKeep) => {
      const r = list.createDiv({ cls: `ngb-conf-row ngb-conf-marker ${sideCls}` });
      r.createSpan({
        cls: `ngb-conf-num${num === null ? " ngb-conf-num-chrome" : ""}`,
        text: num === null ? "\u25B8" : String(num)
      });
      const body = r.createDiv({ cls: "ngb-conf-marker-body" });
      body.createSpan({ cls: "ngb-conf-side-chip", text: chip });
      const b = body.createEl("button", { text: btnLabel, cls: "ngb-conf-keep" });
      b.addEventListener("click", onKeep);
    };
    for (const seg of this.parsed.segments) {
      if (seg.kind === "text") {
        for (const l of seg.lines) row(lineNo++, l, "");
        continue;
      }
      const idx = seg.index;
      const remote = shortRefLabel(seg.theirsLabel);
      const oursChip = `LOCAL \u2014 yours (${seg.oursLabel || "HEAD"})`;
      const theirsChip = `REMOTE \u2014 theirs${remote ? ` (${remote})` : ""}`;
      const keepOursLabel = "Keep local";
      const keepTheirsLabel = remote ? `Keep remote (${remote})` : "Keep remote";
      const keepOurs = () => void this.applyResolution(idx, "ours");
      const keepTheirs = () => void this.applyResolution(idx, "theirs");
      if (rawMarkers) {
        row(lineNo++, `<<<<<<< ${seg.oursLabel}`.trimEnd(), "ngb-conf-raw ngb-conf-ours");
        chromeRow(null, oursChip, "ngb-conf-ours-head", keepOursLabel, keepOurs);
      } else {
        chromeRow(lineNo++, oursChip, "ngb-conf-ours-head", keepOursLabel, keepOurs);
      }
      for (const l of seg.ours) row(lineNo++, l, "ngb-conf-ours");
      if (seg.base !== void 0) {
        row(lineNo++, rawMarkers ? "|||||||" : "\u2026\u2026\u2026 common ancestor:", "ngb-conf-base ngb-conf-raw");
        for (const l of seg.base) row(lineNo++, l, "ngb-conf-base");
      }
      row(lineNo++, rawMarkers ? "=======" : "\u2014\u2014\u2014", "ngb-conf-divider ngb-conf-raw");
      for (const l of seg.theirs) row(lineNo++, l, "ngb-conf-theirs");
      if (rawMarkers) {
        row(lineNo++, `>>>>>>> ${seg.theirsLabel}`.trimEnd(), "ngb-conf-raw ngb-conf-theirs");
        chromeRow(null, theirsChip, "ngb-conf-theirs-head", keepTheirsLabel, keepTheirs);
      } else {
        chromeRow(lineNo++, theirsChip, "ngb-conf-theirs-head", keepTheirsLabel, keepTheirs);
      }
    }
    if (this.actions.showInvisibles()) markInvisibles(list, ".ngb-conf-text");
  }
  async applyResolution(blockIndex, side) {
    const path = this.path;
    if (path === null || this.parsed === null || this.originalText === null) return;
    const current = await this.actions.readFile(path);
    if (current !== this.originalText) {
      new import_obsidian13.Notice("The file changed on disk \u2014 reloading instead of overwriting.");
      await this.reload();
      return;
    }
    const next = resolveBlock(this.parsed, blockIndex, side);
    await this.actions.writeFile(path, next);
    await this.reload();
  }
};
function shortRefLabel(label2) {
  const l = label2.trim();
  if (/^[0-9a-f]{12,40}$/i.test(l)) return l.slice(0, 8);
  return l.length > 24 ? `${l.slice(0, 24)}\u2026` : l;
}

// src/ui/FileHistoryView.ts
var import_obsidian14 = require("obsidian");

// src/git/hunks.ts
function parseHunks(diff) {
  const out = [];
  let cur = null;
  for (const rawLine of diff.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("@@")) {
      cur = { header: line, before: [], after: [] };
      out.push(cur);
      continue;
    }
    if (cur === null) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    const body = line.slice(1);
    if (line.startsWith("+")) cur.after.push(body);
    else if (line.startsWith("-")) cur.before.push(body);
    else if (line.startsWith(" ")) {
      cur.before.push(body);
      cur.after.push(body);
    }
  }
  return out;
}
function restoreHunk(currentText, hunk) {
  const lines = currentText.split("\n");
  const already = indexOfBlock(lines, hunk.after);
  if (already >= 0) return { ok: true, text: currentText, changed: false };
  const at = indexOfBlock(lines, hunk.before);
  if (at < 0) return { ok: false, reason: "not-found" };
  const next = [...lines.slice(0, at), ...hunk.after, ...lines.slice(at + hunk.before.length)];
  return { ok: true, text: next.join("\n"), changed: true };
}
function indexOfBlock(lines, block) {
  if (block.length === 0) return -1;
  for (let i = 0; i + block.length <= lines.length; i++) {
    let hit = true;
    for (let j = 0; j < block.length; j++) {
      if (lines[i + j] !== block[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}

// src/ui/FileHistoryView.ts
var NGB_FILE_HISTORY_VIEW = "native-git-bridge-file-history";
var FileHistoryView = class extends import_obsidian14.ItemView {
  constructor(leaf, actions) {
    super(leaf);
    this.actions = actions;
    this.path = null;
    this.entries = [];
    this.skip = 0;
    this.pageSize = 30;
    this.exhausted = false;
    this.loading = false;
    this.expanded = /* @__PURE__ */ new Set();
    this.listEl = null;
    this.moreBtn = null;
    /**
     * Diffs already fetched, by commit hash. Without it a theme switch or a
     * colour tweak re-ran `diff-file` in Termux for every expanded commit —
     * rerender() promises "no round trip" and now keeps that promise.
     */
    this.diffCache = /* @__PURE__ */ new Map();
    this.navigation = true;
  }
  getViewType() {
    return NGB_FILE_HISTORY_VIEW;
  }
  getDisplayText() {
    const base = this.path?.split("/").pop();
    return base ? `History: ${base}` : "File history";
  }
  getIcon() {
    return "file-clock";
  }
  getState() {
    return { path: this.path };
  }
  async setState(state, result) {
    const s = state;
    if (s && typeof s.path === "string") {
      this.path = s.path;
      this.entries = [];
      this.diffCache.clear();
      this.skip = 0;
      this.exhausted = false;
      this.expanded.clear();
      this.renderShell();
      await this.loadMore();
    }
    return super.setState(state, result);
  }
  async onOpen() {
    this.renderShell();
    if (this.path !== null && this.entries.length === 0) await this.loadMore();
  }
  /**
   * Redraw the loaded commits from memory — no Termux round trip. Used when a
   * display preference (wrap, invisibles, colours) or the theme changes, so
   * this panel follows them exactly like the diff pane does.
   */
  rerender() {
    if (this.path === null) return;
    const entries = this.entries;
    this.renderShell();
    for (const e of entries) this.renderCommit(e);
    if (!this.exhausted) this.moreBtn?.show();
  }
  renderShell() {
    const c = this.contentEl;
    c.empty();
    c.addClass("ngb-status-view", "ngb-history-view", "ngb-filehist-view");
    const head = c.createDiv({ cls: "ngb-filehist-path ngb-mono" });
    head.setText(this.path ?? "");
    head.setAttribute("aria-label", this.path ?? "");
    this.listEl = c.createDiv({ cls: "ngb-hist-list" });
    const btns = c.createDiv({ cls: "ngb-buttons" });
    this.moreBtn = btns.createEl("button", { text: "Load more" });
    this.moreBtn.addEventListener("click", () => void this.loadMore());
    this.moreBtn.hide();
  }
  async loadMore() {
    const path = this.path;
    if (path === null || this.loading || this.exhausted) return;
    this.loading = true;
    const waiting = this.listEl?.createDiv({ cls: "ngb-filehist-waiting" });
    if (waiting) this.renderWaiting(waiting, "Loading history");
    const page = await this.actions.loadPage(path, this.skip, this.pageSize);
    waiting?.remove();
    this.loading = false;
    if (page === null) return;
    if (this.skip === 0 && page.length === 0) {
      this.listEl?.createEl("p", {
        cls: "ngb-settings-note",
        text: "No commits touch this file yet."
      });
      return;
    }
    if (page.length < this.pageSize) {
      this.exhausted = true;
      this.moreBtn?.hide();
    } else {
      this.moreBtn?.show();
    }
    this.entries.push(...page);
    this.skip += page.length;
    for (const e of page) this.renderCommit(e);
  }
  /** The panel's own "the runner is working" indicator, repeated in place. */
  renderWaiting(el, what) {
    el.empty();
    const spin = el.createSpan({ cls: "ngb-anim-spin ngb-sv-icon-active" });
    (0, import_obsidian14.setIcon)(spin, "refresh-cw");
    const text = el.createSpan({ cls: "ngb-settings-note" });
    const tick = () => {
      const p = this.actions.progressText();
      text.setText(p === "" ? `${what}\u2026` : p);
    };
    tick();
    const id = this.registerInterval(window.setInterval(tick, 500));
  }
  renderCommit(e) {
    if (!this.listEl) return;
    const wrap = this.listEl.createDiv({ cls: "ngb-hist-commit" });
    const header = wrap.createDiv({ cls: "ngb-sv-group-header ngb-hist-header" });
    const chevron = header.createSpan({ cls: "ngb-sv-chevron" });
    const open = this.expanded.has(e.hash);
    (0, import_obsidian14.setIcon)(chevron, open ? "chevron-down" : "chevron-right");
    const titles = header.createDiv({ cls: "ngb-hist-titles" });
    titles.createDiv({ cls: "ngb-hist-subject", text: e.subject || "(no subject)" });
    titles.createDiv({
      cls: "ngb-settings-note ngb-hist-meta",
      text: `${e.hash.slice(0, 8)} \xB7 ${e.date.slice(0, 16).replace("T", " ")} \xB7 ${e.author}`
    });
    titles.createDiv({ cls: "ngb-filehist-change", text: describeFileChange(e) });
    const viewAt = header.createEl("button", { cls: "ngb-filehist-restore ngb-filehist-viewat" });
    const vi = viewAt.createSpan({ cls: "ngb-filehist-restore-icon" });
    (0, import_obsidian14.setIcon)(vi, "eye");
    viewAt.setAttribute("aria-label", `Show the file as it was at ${e.hash.slice(0, 8)}`);
    viewAt.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.actions.viewAtCommit(e);
    });
    const restore = header.createEl("button", { cls: "ngb-filehist-restore" });
    const ic = restore.createSpan({ cls: "ngb-filehist-restore-icon" });
    (0, import_obsidian14.setIcon)(ic, "rotate-ccw");
    restore.createSpan({ cls: "ngb-filehist-restore-label", text: "Restore file" });
    restore.setAttribute("aria-label", `Restore this file from ${e.hash.slice(0, 8)}`);
    restore.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (this.path !== null) this.actions.restoreWholeFile(this.path, e);
    });
    const body = wrap.createDiv({ cls: "ngb-filehist-body" });
    header.addEventListener("click", () => {
      if (this.expanded.has(e.hash)) {
        this.expanded.delete(e.hash);
        (0, import_obsidian14.setIcon)(chevron, "chevron-right");
        body.empty();
        return;
      }
      this.expanded.add(e.hash);
      (0, import_obsidian14.setIcon)(chevron, "chevron-down");
      void this.renderCommitDiff(body, e);
    });
    if (open) void this.renderCommitDiff(body, e);
  }
  /**
   * Obsidian calls this on every size change, including a rotation. The
   * embedded diffs are the same diff2html DOM the diff pane renders, and its
   * wrapped layout is measured, so they have to be re-measured here too.
   */
  onResize() {
    for (const pane of Array.from(this.contentEl.querySelectorAll(".ngb-filehist-diff"))) {
      pane.toggleClass("ngb-diff-wrap", this.actions.wrapLines());
      sizeGutter(pane);
    }
  }
  async renderCommitDiff(body, e) {
    body.empty();
    const cached = this.diffCache.get(e.hash);
    let res;
    if (cached !== void 0) {
      res = cached;
    } else {
      this.renderWaiting(body.createDiv({ cls: "ngb-filehist-waiting" }), "Loading diff");
      res = await this.actions.loadCommitDiff(e);
      if (res !== null) this.diffCache.set(e.hash, res);
    }
    if (!this.expanded.has(e.hash)) return;
    body.empty();
    if (res === null) {
      body.createEl("p", { cls: "ngb-warning", text: "Could not load the diff (see the error message)." });
      return;
    }
    if (res.diff.trim() === "") {
      body.createEl("p", { cls: "ngb-ok", text: "No differences." });
      return;
    }
    const hunks = parseHunks(res.diff);
    const rendered = html(res.diff, {
      drawFileList: false,
      diffStyle: "char",
      outputFormat: "line-by-line"
    });
    const pane = body.createDiv({ cls: "ngb-diff-view ngb-filehist-diff" });
    pane.toggleClass("ngb-diff-wrap", this.actions.wrapLines());
    pane.appendChild((0, import_obsidian14.sanitizeHTMLToDom)(rendered));
    for (const tr of Array.from(pane.querySelectorAll("tr"))) {
      const gutter = tr.querySelector(".d2h-code-linenumber");
      const prefix = tr.querySelector(".d2h-code-line-prefix");
      if (gutter && prefix) gutter.appendChild(prefix);
    }
    sizeGutter(pane);
    const colors = this.actions.colors();
    for (const name of DIFF_COLOR_VARS) {
      if (colors && colors[name]) pane.style.setProperty(name, colors[name]);
      else pane.style.removeProperty(name);
    }
    if (this.actions.showInvisibles()) markInvisibles(pane);
    const files = Array.from(pane.querySelectorAll(".d2h-file-wrapper"));
    const rows = files.length > 0 ? Array.from(files[0].querySelectorAll("tr")) : [];
    let hunkIndex = 0;
    for (const tr of rows) {
      if (tr.querySelector(".d2h-info") === null) continue;
      const hunk = hunks[hunkIndex++];
      if (hunk === void 0) continue;
      const bar = createDiv({ cls: "ngb-hunk-bar" });
      const b = bar.createEl("button", { cls: "ngb-hunk-restore" });
      const bi = b.createSpan({ cls: "ngb-filehist-restore-icon" });
      (0, import_obsidian14.setIcon)(bi, "rotate-ccw");
      b.createSpan({ text: "Restore this block" });
      b.setAttribute("aria-label", `Restore this block from ${e.hash.slice(0, 8)}`);
      b.addEventListener("click", () => void this.restoreBlock(hunk, e));
      tr.parentElement?.insertBefore(wrapRow(bar, tr), tr);
    }
    if (res.truncated) {
      body.createDiv({
        cls: "ngb-warning",
        text: "Diff truncated (too large). Restoring whole blocks may be incomplete."
      });
    }
  }
  /** Put one block back the way this commit left it, or explain why not. */
  async restoreBlock(hunk, e) {
    const path = this.path;
    if (path === null) return;
    const current = await this.actions.readFile(path);
    if (current === null) {
      new import_obsidian14.Notice("This file cannot be edited here (binary or unreadable).");
      return;
    }
    const out = restoreHunk(current, hunk);
    if (!out.ok) {
      new import_obsidian14.Notice(
        "That block no longer matches the current file, so it was not touched. Restore the whole file version instead."
      );
      return;
    }
    if (!out.changed) {
      new import_obsidian14.Notice("This block already matches that commit.");
      return;
    }
    await this.actions.writeFile(path, out.text);
    new import_obsidian14.Notice(`Restored one block from ${e.hash.slice(0, 8)}.`);
  }
};
function wrapRow(bar, sibling) {
  const tr = createEl("tr", { cls: "ngb-hunk-bar-row" });
  const td = tr.createEl("td");
  const cols = sibling.children.length || 2;
  td.setAttribute("colspan", String(cols));
  td.appendChild(bar);
  return tr;
}

// src/bridge/selfCheck.ts
var LOG_TAIL_BYTES = 4e3;
async function runSelfCheck(fs, paths, hasQueuedTimeout, profileId = "") {
  const runtimeDirExists = await safeExists(fs, paths.root);
  const queuedRequests = runtimeDirExists && await safeExists(fs, paths.requestsDir) ? (await safeList(fs, paths.requestsDir)).filter((f) => f.endsWith(".json")).map(baseName) : [];
  const logPath = `${paths.root}/runner.log`;
  const runnerLogExists = await safeExists(fs, logPath);
  let runnerLogTail = "";
  if (runnerLogExists) {
    try {
      const text = await fs.read(logPath);
      runnerLogTail = text.length > LOG_TAIL_BYTES ? text.slice(-LOG_TAIL_BYTES) : text;
    } catch {
      runnerLogTail = "(runner.log could not be read)";
    }
  }
  const pairingFilePresent = await safeExists(fs, `${paths.root}/${PAIRING_FILE}`);
  const claimPending = await safeExists(fs, `${paths.root}/${CLAIM_FILE}`);
  let markerProfileId = "";
  try {
    const raw = await fs.read(`${paths.root}/${PROFILE_MARKER_FILE}`);
    const parsed = JSON.parse(raw);
    if (typeof parsed.profileId === "string") markerProfileId = parsed.profileId;
  } catch {
  }
  let verdict;
  let ok = false;
  if (!runtimeDirExists) {
    verdict = "The runtime folder does not exist yet. Run a command once (it is created automatically), or complete the Termux setup.";
  } else if (!runnerLogExists) {
    verdict = claimPending ? "This vault is waiting to be paired: the pairing request is still lying here, so Termux has not run yet. Open Termux (or tap 'Pair this vault' again) \u2014 the runner picks the request up on its next run." : "No runner.log in this vault's runtime folder \u2014 the Termux runner has never written here, so no profile points at THIS vault. Fix: run the install command below in Termux with this vault's path (each vault gets its own profile and token; other vaults keep working), or use 'Pair this vault' if Termux is already set up.";
  } else if (markerProfileId && profileId && markerProfileId !== profileId) {
    verdict = `This vault is paired with profile ${profileId}, but the runner last wrote profile ${markerProfileId} here. Re-run the install command for this vault to get the two back in step.`;
  } else if (hasQueuedTimeout && queuedRequests.length > 0) {
    verdict = "The runner has written here before, but your request is still queued. Either the runner was not triggered (companion permission / allow-external-apps), or it stopped before processing the queue \u2014 see the log tail below.";
  } else if (queuedRequests.length > 0) {
    verdict = `${queuedRequests.length} request(s) waiting to be processed.`;
  } else {
    verdict = "Runtime folder looks healthy: the runner writes here and no requests are stuck.";
    ok = true;
  }
  return {
    runtimeDirExists,
    queuedRequests,
    runnerLogExists,
    runnerLogTail,
    pairingFilePresent,
    profileId,
    markerProfileId,
    claimPending,
    verdict,
    ok
  };
}
async function safeExists(fs, p) {
  try {
    return await fs.exists(p);
  } catch {
    return false;
  }
}
async function safeList(fs, p) {
  try {
    return await fs.listFiles(p);
  } catch {
    return [];
  }
}
function baseName(p) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

// src/git/remoteUrl.ts
var MAX_REMOTE_URL_LENGTH = 512;
var REASONS = {
  empty: "Enter the repository URL.",
  "too-long": `The URL is longer than ${MAX_REMOTE_URL_LENGTH} characters.`,
  "option-like": "A URL may not start with '-': git would read it as an option, not an address.",
  "not-printable-ascii": "The URL contains a space or a character that is not plain ASCII. Copy it again from your git host.",
  credentials: "This URL carries a password. Remove it: credentials stay in Termux (a credential helper, an SSH key, or `gh auth login`), and this plugin never handles one.",
  "unsupported-scheme": "Use https://host/owner/repo.git, ssh://host/path, git@host:owner/repo.git, or file:///absolute/path for a local copy. Plain http and git:// are not accepted."
};
var PRINTABLE_ASCII = /^[!-~]+$/;
var CREDENTIALS = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/@]*:[^/@]*@/;
var SCP_LIKE = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:[^ ]+$/;
function validateRemoteUrl(raw) {
  const url = raw.trim();
  const fail = (problem) => ({
    ok: false,
    url,
    problem,
    reason: REASONS[problem]
  });
  if (url === "") return fail("empty");
  if (url.length > MAX_REMOTE_URL_LENGTH) return fail("too-long");
  if (url.startsWith("-")) return fail("option-like");
  if (!PRINTABLE_ASCII.test(url)) return fail("not-printable-ascii");
  if (CREDENTIALS.test(url)) return fail("credentials");
  if (url.startsWith("https://") || url.startsWith("ssh://") || url.startsWith("file:///")) {
    return { ok: true, url };
  }
  if (SCP_LIKE.test(url)) return { ok: true, url };
  return fail("unsupported-scheme");
}
function redactRemoteUrl(url) {
  return url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@]+@/, "$1***@");
}
function isValidBranchName(name) {
  if (name === "" || name.length > 100) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)) return false;
  if (name.includes("..") || name.includes("//")) return false;
  if (name.endsWith(".lock") || name.endsWith("/")) return false;
  return true;
}

// src/main.ts
var import_obsidian16 = require("obsidian");
var DEFAULT_SHARED_PREFS = {
  showStatusBar: true,
  showRibbonIcon: true,
  wrapDiffLines: false,
  showInvisibles: false,
  showConflictMarkers: false,
  treeView: false,
  customColors: false,
  colorsLight: { ...DEFAULT_COLORS.light },
  colorsDark: { ...DEFAULT_COLORS.dark }
};
var MARKER_KEY = "active-op";
var LAST_SYNC_KEY = "last-sync";
var NativeGitBridgePlugin = class extends import_obsidian15.Plugin {
  constructor() {
    super(...arguments);
    this.sharedPrefs = { ...DEFAULT_SHARED_PREFS };
    this.statusBar = null;
    this.activeCancel = null;
    this.progressText = null;
    this.runningAction = null;
    /** Target path of the running action, when it is per-path (stage/unstage/discard file). */
    this.runningPath = null;
    this.lastStatus = null;
    this.lastAutoSyncMs = 0;
    this.statusPollId = null;
    /**
     * Ask Termux to pair THIS vault, without re-running the installer.
     *
     * The trigger the companion sends is fixed and carries no vault identity, so
     * the request goes the other way: the plugin drops a claim file into its own
     * runtime folder and triggers a runner run. The runner, when it has nothing
     * else to do, finds the claim, verifies the folder really is a repository of
     * its own, generates the token IN TERMUX and answers with a pairing file.
     * Nothing secret leaves Termux, and nothing the claim contains is trusted.
     *
     * Poll interval and budget are fields so tests can shrink them.
     */
    this.pairingPollMs = 500;
    this.pairingWaitMs = PAIRING_WAIT_MS;
    /** Remote URL of the repository as of the last status (already redacted by the runner). */
    this.lastRemoteUrl = "";
    /**
     * Warn once per session when the Termux-side runner predates this plugin
     * build. Updating main.js in the vault does not touch the runner script, so a
     * stale runner is a genuinely common failure mode (it shows up as
     * RUNNER_INTERNAL / serialization errors).
     */
    this.runnerVersionWarned = false;
    this.companionSetupAutoOpened = false;
    /** Last runner version reported by a result (0 = never heard from). */
    this.lastRunnerVersion = 0;
    /** Probe window used by the missing-companion detection; tests shrink it. */
    this.companionProbeMs = 4e3;
    /** Time of the last obsidian://native-git-bridge-ack from the companion. */
    this.lastCompanionAckMs = 0;
    /** What the companion reported about Termux (null until the first ack). */
    this.lastAckTermuxInstalled = null;
    /** Companion version from its ack ("" until one arrives). */
    this.lastCompanionVersion = "";
    this.ackWaiters = [];
    // -------------------- repo config management (sparse / gitignore / exclude)
    /** In-memory caches so the file context menu can decide add-vs-remove synchronously. */
    this.gitignoreLines = [];
    this.excludeLines = [];
  }
  async onload() {
    this.store = new DeviceLocalSettingsStore(getLocalStorageBackend(), this.resolveScopeId());
    this.deviceSettings = this.store.read();
    this.lastRunnerVersion = Number(this.store.getValue("last-runner-version") ?? 0) || 0;
    this.lastCompanionVersion = this.store.getValue("last-companion-version") ?? "";
    this.log = new OperationLog(this.store);
    const data = await this.loadData();
    this.sharedPrefs = { ...DEFAULT_SHARED_PREFS, ...data ?? {} };
    this.sharedPrefs.colorsLight = sanitizeColorSet(this.sharedPrefs.colorsLight, "light");
    this.sharedPrefs.colorsDark = sanitizeColorSet(this.sharedPrefs.colorsDark, "dark");
    registerIcons();
    const paths = new RuntimePaths(this.app.vault.configDir);
    this.client = new BridgeClient(this.makeRuntimeFS(), paths);
    this.lock = new OperationLock((marker) => this.persistMarker(marker));
    if (this.sharedPrefs.showStatusBar) {
      this.statusBar = new StatusBarController(this.addStatusBarItem(), () => this.openStatusModal());
    }
    if (this.sharedPrefs.showRibbonIcon) {
      this.addRibbonIcon("git-branch", "Native Git: status panel", () => {
        void this.openStatusPanel();
        void this.cmdStatus(true);
      });
    }
    this.registerView(
      NGB_STATUS_VIEW,
      (leaf) => new StatusView(leaf, {
        refresh: () => void this.cmdStatus(true),
        sync: () => void this.cmdSync(),
        pull: () => void this.cmdPull(),
        push: () => void this.cmdPush(),
        fetch: () => void this.cmdFetch(),
        commit: () => void this.cmdCommit(),
        stageAll: () => void this.cmdStageAll(),
        unstageAll: () => void this.cmdUnstageAll(),
        openLog: () => new OperationLogModal(this.app, this.log).open(),
        toggleTree: () => void this.setSharedPref({ treeView: !this.sharedPrefs.treeView }),
        folderAction: (group, folderPath, kind) => this.folderAction(group, folderPath, kind),
        openHistory: () => void this.openHistoryPanel(),
        cancel: () => void this.cmdCancel(),
        openFile: (p) => this.openVaultFile(p),
        openDiff: (p, group) => void this.openStatusDiff(p, group),
        openConflict: (p, pos) => void this.openConflict(p, pos),
        stage: (p) => void this.cmdStageFile(p),
        unstage: (p) => void this.cmdUnstageFile(p),
        discard: (p) => this.cmdDiscardFile(p),
        fileMenu: (p, group, pos) => {
          const menu = new import_obsidian15.Menu();
          this.buildGitMenu(menu, p, group);
          menu.showAtPosition(pos);
        },
        groupAction: (group, kind) => this.groupAction(group, kind),
        groupMenu: (group, pos) => {
          const menu = new import_obsidian15.Menu();
          this.buildGroupMenu(menu, group);
          menu.showAtPosition(pos);
        }
      })
    );
    this.registerView(
      NGB_HISTORY_VIEW,
      (leaf) => new HistoryView(leaf, {
        loadPage: (skip, limit) => this.loadRepoLogPage(skip, limit),
        openDiffAtCommit: (file, entry2) => void this.openCommitDiff(file, entry2),
        openFile: (p) => this.openVaultFile(p),
        progressText: () => this.progressText ?? "",
        treeView: () => this.sharedPrefs.treeView,
        toggleTree: () => void this.setSharedPref({ treeView: !this.sharedPrefs.treeView })
      })
    );
    this.registerView(
      NGB_DIFF_VIEW,
      (leaf) => new DiffView(leaf, {
        loadDiff: (path, from, to) => this.loadDiffText(path, from, to),
        wrapLines: () => this.sharedPrefs.wrapDiffLines,
        showInvisibles: () => this.sharedPrefs.showInvisibles,
        colors: () => this.diffColorVars(),
        progressText: () => this.progressText ?? ""
      })
    );
    this.registerView(
      NGB_FILE_HISTORY_VIEW,
      (leaf) => new FileHistoryView(leaf, {
        loadPage: (path, skip, limit) => this.loadFileLogPage(path, skip, limit),
        loadCommitDiff: (e) => this.loadDiffText(e.pathAtCommit, `${e.hash}^`, e.hash),
        readFile: (p) => this.readVaultTextFile(p),
        writeFile: async (p, text) => {
          await this.app.vault.adapter.write(p, text);
        },
        restoreWholeFile: (p, e) => this.confirmRestore(p, e),
        viewAtCommit: (e) => void this.showFileAtCommit(e),
        progressText: () => this.progressText ?? "",
        wrapLines: () => this.sharedPrefs.wrapDiffLines,
        showInvisibles: () => this.sharedPrefs.showInvisibles,
        colors: () => this.diffColorVars()
      })
    );
    this.registerView(
      NGB_CONFLICT_VIEW,
      (leaf) => new ConflictView(leaf, {
        readFile: (p) => this.readVaultTextFile(p),
        writeFile: async (p, content) => {
          await this.app.vault.adapter.write(p, content);
        },
        stageFile: (p) => this.cmdStageFile(p),
        markersVisible: () => this.sharedPrefs.showConflictMarkers,
        showInvisibles: () => this.sharedPrefs.showInvisibles,
        colors: () => this.conflictColorVars()
      })
    );
    this.registerEvent(this.app.workspace.on("css-change", () => this.refreshDiffPanes()));
    this.addSettingTab(new NativeGitBridgeSettingTab(this.app, this));
    this.registerCommands();
    this.registerFileMenu();
    this.app.workspace.onLayoutReady(() => {
      void this.startupChecks();
    });
    this.registerAutomaticActions();
  }
  /**
   * Right-click / long-tap entries on files and folders: stage/unstage,
   * .gitignore, sparse hide/show, .git/info/exclude. All decisions come from
   * in-memory caches (last status, .gitignore, exclude list) because menu
   * building is synchronous — no Termux round trip here.
   */
  registerFileMenu() {
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        this.buildGitMenu(menu, file.path);
      })
    );
  }
  /**
   * The Git entries for one file or folder. Shared by the file explorer's
   * file-menu and the long-press / right-click menu on rows in the status
   * panel, so the two can never drift apart.
   */
  buildGitMenu(menu, path, known, kind = "file") {
    if (!import_obsidian15.Platform.isAndroidApp) return;
    if (!this.deviceSettings.enabledOnThisDevice) return;
    const v = validateRepoRelativePath(path);
    if (!v.ok) return;
    const p = v.normalized;
    const group = known ?? this.inferGroup(p);
    const scope = kind === "folder" ? { kind: "folder", path: p, group, count: this.pathsUnder(p, group).length } : { kind: "file", path: p, group };
    this.addMenuEntries(menu, scope);
  }
  /** Which panel group a path belongs to, from the last status the panel saw. */
  inferGroup(p) {
    const st = this.lastStatus?.status;
    const under = (path) => path === p || path.startsWith(p + "/");
    if (st?.conflicted.some((e) => under(e.path))) return "conflicted";
    if (st?.unstaged.some((e) => under(e.path))) return "unstaged";
    if (st?.untracked.some(under)) return "untracked";
    if (st?.staged.some((e) => under(e.path))) return "staged";
    return "unstaged";
  }
  /** Paths of a group at or under `base` (empty base = the whole group). */
  pathsUnder(base, group) {
    return this.groupPaths(group).filter(
      (f) => base === "" || f === base || f.startsWith(base + "/")
    );
  }
  /** Turn the shared menu description into real Obsidian menu items. */
  addMenuEntries(menu, scope) {
    const single = scope.kind === "file";
    const path = scope.kind === "group" ? "" : scope.path;
    const targets = () => single ? [path] : this.pathsUnder(path, scope.group);
    const entries = buildMenuEntries(scope, {
      menuGitignore: this.deviceSettings.menuGitignore,
      menuSparse: this.deviceSettings.menuSparse,
      menuExclude: this.deviceSettings.menuExclude,
      ignored: single && this.isGitignored(path),
      sparseExcluded: single && this.isSparseExcluded(path),
      excluded: single && this.isExcluded(path)
    });
    for (const e of entries) {
      menu.addItem((i) => {
        i.setTitle(e.title).setIcon(e.icon);
        i.onClick(() => this.runMenuAction(e.action, scope, targets));
      });
    }
  }
  runMenuAction(action, scope, targets) {
    const path = scope.kind === "group" ? "." : scope.path;
    const group = scope.group;
    switch (action) {
      case "stage":
        if (scope.kind === "group") this.groupAction(group, "stage");
        else void this.cmdStageFile(path, group === "unstaged" ? "update" : "all");
        return;
      case "unstage":
        if (scope.kind === "group") void this.cmdUnstageAll();
        else void this.cmdUnstageFile(path);
        return;
      case "discard":
        if (scope.kind === "group") this.groupAction(group, "discard");
        else this.folderAction(group, path, "discard");
        return;
      case "resolve-local":
      case "resolve-remote": {
        const side = action === "resolve-local" ? "ours" : "theirs";
        if (scope.kind === "file") this.cmdResolveConflict(path, side);
        else this.confirmResolveMany(targets(), side);
        return;
      }
      case "open-diff":
        void this.openStatusDiff(path, group);
        return;
      case "open-conflict":
        void this.openConflict(path, { x: 0, y: 0 });
        return;
      case "open-history":
        void this.openFileHistoryPanel(path);
        return;
      case "open-external":
        this.openWithDefaultApp(path);
        return;
      case "copy-path":
        void navigator.clipboard.writeText(path);
        new import_obsidian15.Notice("Path copied.");
        return;
      case "abort-merge":
        void this.cmdAbortMerge();
        return;
      case "gitignore-add":
        if (scope.kind === "file") void this.gitignoreAdd(`/${path}`);
        else this.confirmBulkIgnore(targets());
        return;
      case "gitignore-remove":
        void this.gitignoreRemove(`/${path}`);
        return;
      case "sparse-add":
        if (scope.kind === "file") void this.cmdSparseExclude(path, true);
        else this.confirmBulkPerPath(targets(), "sparse");
        return;
      case "sparse-remove":
        void this.cmdSparseExclude(path, false);
        return;
      case "exclude-add":
        if (scope.kind === "file") void this.cmdExcludeChange(path, true);
        else this.confirmBulkPerPath(targets(), "exclude");
        return;
      case "exclude-remove":
        void this.cmdExcludeChange(path, false);
        return;
    }
  }
  /** Resolve several conflicted files the same way, after one confirmation. */
  confirmResolveMany(paths, side) {
    if (paths.length === 0) return;
    new ConfirmModal(
      this.app,
      {
        title: side === "ours" ? "Keep the LOCAL version of these files?" : "Keep the REMOTE version of these files?",
        body: [
          ...paths.slice(0, 10),
          paths.length > 10 ? `\u2026and ${paths.length - 10} more` : "",
          side === "ours" ? "The incoming remote changes to these files are discarded." : "Your local changes to these files are discarded.",
          `This runs one Termux round trip per file (${paths.length} in total).`
        ].filter((l) => l !== ""),
        confirmLabel: side === "ours" ? "Keep local" : "Keep remote",
        danger: true
      },
      async (ok) => {
        if (!ok) return;
        for (const p of paths) {
          const result = await this.runOperation("resolve-conflict", {
            path: p,
            side,
            protectedPaths: this.effectiveProtectedPaths()
          });
          if (!result?.ok) break;
          this.absorbStatusData(result.data ?? {});
        }
        await this.cmdStatus(true);
      }
    ).open();
  }
  /**
   * (Re)start the status auto-refresh timer (Settings → "Auto-refresh
   * status"). Fires only while the status panel exists, Obsidian is visible
   * and nothing is in flight — every refresh is a Termux round trip.
   */
  restartStatusPoll() {
    if (this.statusPollId !== null) {
      window.clearInterval(this.statusPollId);
      this.statusPollId = null;
    }
    const secs = Math.floor(this.deviceSettings.statusRefreshSeconds);
    if (!Number.isFinite(secs) || secs <= 0) return;
    this.statusPollId = window.setInterval(() => {
      void this.maybeAutoStatus();
    }, secs * 1e3);
    this.registerInterval(this.statusPollId);
  }
  async maybeAutoStatus() {
    const s = this.deviceSettings;
    if (!s.enabledOnThisDevice || !s.termuxIntegrationEnabled || !s.authToken) return;
    if (document.visibilityState === "hidden") return;
    if (this.lock.active || this.runningAction !== null) return;
    if (this.app.workspace.getLeavesOfType(NGB_STATUS_VIEW).length === 0) return;
    await this.cmdStatus(true);
  }
  registerAutomaticActions() {
    this.restartStatusPoll();
    const s = this.deviceSettings;
    if (s.periodicSyncMinutes > 0) {
      this.registerInterval(
        window.setInterval(() => {
          void this.maybeAutoSync("periodic");
        }, s.periodicSyncMinutes * 6e4)
      );
    }
    if (s.autoSyncOnClose) {
      const onHide = () => {
        if (document.visibilityState === "hidden") void this.queueSyncAndForget();
      };
      this.registerDomEvent(document, "visibilitychange", onHide);
    }
  }
  async maybeAutoSync(reason) {
    const s = this.deviceSettings;
    if (!s.enabledOnThisDevice || !s.termuxIntegrationEnabled || !s.authToken) return;
    if (this.lock.active) return;
    const minGap = s.minAutoSyncIntervalMinutes * 6e4;
    if (Date.now() - this.lastAutoSyncMs < minGap) return;
    if (!this.autoActionAllowed()) return;
    this.lastAutoSyncMs = Date.now();
    this.log.add("info", "auto", `Automatic sync (${reason}).`);
    await this.cmdSync(void 0, true);
  }
  /** Queue a sync request without waiting (used only on close/background). */
  async queueSyncAndForget() {
    const s = this.deviceSettings;
    if (!s.enabledOnThisDevice || !s.termuxIntegrationEnabled || !s.authToken) return;
    if (this.lock.active) return;
    const minGap = s.minAutoSyncIntervalMinutes * 6e4;
    if (Date.now() - this.lastAutoSyncMs < minGap) return;
    this.lastAutoSyncMs = Date.now();
    try {
      const req = createRequest(
        "sync",
        { protectedPaths: this.effectiveProtectedPaths(), message: "vault sync on close (native git bridge)" },
        s.authToken,
        s.opTimeoutSeconds
      );
      await this.client.submit(req);
      this.makeTransport().trigger(req.id);
      this.log.add("info", "auto", `Sync-on-close request ${req.id} queued (fire and forget).`);
    } catch (e) {
      this.log.add("warn", "auto", `Sync-on-close queueing failed: ${String(e)}`);
    }
  }
  onunload() {
    this.activeCancel?.cancel();
  }
  // --------------------------------------------------------------- messaging
  /**
   * Route a short informational message according to the device setting.
   * Failures never go through here — they always surface as a modal.
   *
   * Note: an Obsidian plugin cannot raise native Android toasts; the choices are
   * an in-app notice, the status panel, or the log only.
   */
  notify(message) {
    const mode = this.deviceSettings.notificationMode;
    this.log.add("info", "notify", message);
    if (mode === "notice") new import_obsidian15.Notice(message);
    else if (mode === "status-only") {
      this.progressText = message;
      this.updateProgressInView(message);
      window.setTimeout(() => {
        if (this.progressText === message) {
          this.progressText = null;
          this.updateProgressInView(null);
        }
      }, 4e3);
    }
  }
  /** Result window for a SUCCESSFUL operation: shown only when enabled. */
  reportSuccess(title, lines, stdout) {
    if (this.deviceSettings.showSuccessModals) {
      new ResultModal(this.app, title, lines, { stdout }).open();
    } else {
      this.notify(`${title}: ${lines[0] ?? "done"}`);
      if (stdout) this.log.add("info", "result", title, stdout);
    }
  }
  // ------------------------------------------------------------------ setup
  resolveScopeId() {
    const appId = this.app.appId;
    if (typeof appId === "string" && appId.length > 0) return appId;
    const backend = getLocalStorageBackend();
    const fallbackKey = `${STORAGE_PREFIX}:__scope:${this.app.vault.getName()}`;
    try {
      const existing = backend?.getItem(fallbackKey);
      if (existing) return existing;
      const fresh = `v-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      backend?.setItem(fallbackKey, fresh);
      return fresh;
    } catch {
      return `volatile-${this.app.vault.getName()}`;
    }
  }
  makeRuntimeFS() {
    const adapter = this.app.vault.adapter;
    return {
      exists: (p) => adapter.exists(p),
      read: (p) => adapter.read(p),
      write: (p, d) => adapter.write(p, d),
      mkdir: (p) => adapter.mkdir(p),
      remove: (p) => adapter.remove(p),
      listFiles: async (p) => (await adapter.list(p)).files
    };
  }
  async startupChecks() {
    this.refreshStatusBarIdle();
    this.warnIfObsidianGitEnabledOnAndroid();
    await this.tryImportPairing();
    await this.reconcileAfterRestart();
    await this.loadGitignore();
    if (import_obsidian15.Platform.isAndroidApp && !this.deviceSettings.authToken && !this.store.getValue("setup-guide-shown")) {
      this.store.setValue("setup-guide-shown", "1");
      this.openSetupGuide("First run: this device is not set up yet.");
    }
    void this.remindAboutPreviousRepos();
    if (this.deviceSettings.enabledOnThisDevice && this.deviceSettings.autoPullOnOpen) {
      if (this.autoActionAllowed()) {
        this.log.add("info", "auto", "Auto pull on open.");
        void this.cmdPull(true);
      }
    }
  }
  /** Best-effort gates for automatic actions (Wi-Fi / battery), default permissive. */
  autoActionAllowed() {
    const s = this.deviceSettings;
    try {
      if (s.wifiOnly) {
        const conn = navigator.connection;
        if (conn?.type && conn.type !== "wifi") return false;
      }
    } catch {
    }
    return true;
  }
  /**
   * obsidian-git is truly active only if it is in the enabled plugin list AND
   * not switched off via its own device-local, non-synced toggle
   * (app.loadLocalStorage("obsidian-git:pluginDisabled") === "true"). Keeping
   * it "enabled" in community-plugins.json (which syncs through the vault)
   * while device-disabled is a perfectly valid setup and must not be flagged.
   */
  isObsidianGitActiveOnDevice() {
    const plugins = this.app.plugins;
    if (!plugins?.enabledPlugins?.has("obsidian-git")) return false;
    let disabled = null;
    try {
      const load = this.app.loadLocalStorage;
      if (typeof load === "function") disabled = load.call(this.app, "obsidian-git:pluginDisabled");
    } catch {
    }
    if (disabled === null || disabled === void 0) {
      try {
        disabled = window.localStorage.getItem("obsidian-git:pluginDisabled");
      } catch {
      }
    }
    return disabled !== "true";
  }
  warnIfObsidianGitEnabledOnAndroid() {
    if (!import_obsidian15.Platform.isAndroidApp) return;
    if (this.deviceSettings.suppressObsidianGitWarning) return;
    if (!this.isObsidianGitActiveOnDevice()) return;
    this.log.add("warn", "compat", "obsidian-git ACTIVE on this Android device alongside Native Git Bridge.");
    new ConfirmModal(
      this.app,
      {
        title: "Plugin compatibility warning",
        body: [
          "The 'Git' (obsidian-git) plugin is ACTIVE on this Android device.",
          "Its mobile backend (isomorphic-git) does not understand native sparse-checkout / skip-worktree index data and may stage protected paths as deletions.",
          "Recommended fix that keeps sync intact: open obsidian-git settings and enable its own 'Disable on this device' toggle (it is not synced), instead of disabling the plugin globally.",
          "Native Git Bridge will never disable another plugin automatically."
        ],
        confirmLabel: "Don't warn again on this device",
        icon: "bell-off"
      },
      async (dontWarnAgain) => {
        if (dontWarnAgain) await this.updateDeviceSettings({ suppressObsidianGitWarning: true });
      }
    ).open();
  }
  /**
   * Import the token dropped by the Termux installer (runtime/pairing.json),
   * then delete the file. Overwriting an existing, different token requires
   * explicit confirmation.
   */
  async tryImportPairing() {
    const adapter = this.app.vault.adapter;
    const path = `${this.app.vault.configDir}/plugins/${this.manifest.id}/runtime/${PAIRING_FILE}`;
    try {
      if (!await adapter.exists(path)) return;
      const pairing = parsePairingFile(await adapter.read(path));
      if (!pairing) {
        this.log.add("warn", "pairing", "pairing.json present but invalid; ignoring.");
        return;
      }
      const apply = async () => {
        await this.updateDeviceSettings({
          authToken: pairing.token,
          repoPathHint: pairing.repoPath ?? this.deviceSettings.repoPathHint,
          profileId: pairing.profileId ?? this.deviceSettings.profileId,
          termuxIntegrationEnabled: true
        });
        try {
          await adapter.remove(path);
        } catch {
        }
        this.log.add("info", "pairing", "Pairing token imported from Termux installer.");
        this.notify("Native Git Bridge: paired with the Termux runner.");
      };
      const current = this.deviceSettings.authToken;
      if (current === "" || current === pairing.token) {
        await apply();
      } else {
        new ConfirmModal(
          this.app,
          {
            title: "Replace pairing token?",
            body: [
              "A new pairing file from the Termux installer was found, but this device already has a different token.",
              "Replace it only if you re-ran the installer on purpose."
            ],
            confirmLabel: "Replace token",
            danger: true
          },
          async (confirmed) => {
            if (confirmed) await apply();
          }
        ).open();
      }
    } catch (e) {
      this.log.add("warn", "pairing", `Pairing import failed: ${String(e)}`);
    }
  }
  /**
   * A result names the profile that answered. The first one teaches this vault
   * its own id; after that the id travels in every request and the runner
   * rejects anything that names a different profile. A mismatch is never
   * silently adopted — that would be the plugin re-pointing itself at another
   * vault's repository.
   */
  async learnProfileId(result) {
    const id = typeof result.profileId === "string" ? result.profileId : "";
    if (!isValidProfileId(id)) return;
    const current = this.deviceSettings.profileId;
    if (current === id) return;
    if (current === "") {
      await this.updateDeviceSettings({ profileId: id });
      this.log.add("info", "pairing", `This vault is served by profile ${id}.`);
      return;
    }
    this.log.add(
      "warn",
      "pairing",
      `A result came back from profile ${id}, but this vault is paired with ${current}. Keeping ${current}; re-run the installer if the vault was re-paired.`
    );
  }
  async cmdPairThisVault() {
    if (!import_obsidian15.Platform.isAndroidApp) {
      new import_obsidian15.Notice("Native Git Bridge works on Android only (it delegates git to Termux).");
      return;
    }
    const adapter = this.app.vault.adapter;
    const root = new RuntimePaths(this.app.vault.configDir).root;
    const claimPath = `${root}/${CLAIM_FILE}`;
    const pairingPath = `${root}/${PAIRING_FILE}`;
    const needsRepo = !await this.vaultHasRepository();
    try {
      await this.client.ensureRuntimeDirs();
      await adapter.write(
        claimPath,
        JSON.stringify(
          {
            createdAt: (/* @__PURE__ */ new Date()).toISOString(),
            vault: this.app.vault.getName(),
            bootstrap: needsRepo
          },
          null,
          2
        )
      );
    } catch (e) {
      new ResultModal(this.app, "Pairing failed", [`The pairing request could not be written: ${String(e)}`], {
        isError: true
      }).open();
      return;
    }
    this.log.add("info", "pairing", "Pairing request written; asking Termux to pick it up.");
    this.makeTransport().trigger(`r-${(/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-pair`);
    new import_obsidian15.Notice("Asked Termux to pair this vault\u2026");
    const deadline = Date.now() + this.pairingWaitMs;
    for (; ; ) {
      await new Promise((r) => window.setTimeout(r, this.pairingPollMs));
      if (await adapter.exists(pairingPath)) {
        await this.tryImportPairing();
        if (this.deviceSettings.authToken) {
          try {
            if (await adapter.exists(claimPath)) await adapter.remove(claimPath);
          } catch {
          }
          new ResultModal(this.app, "This vault is paired", [
            `Profile: ${this.deviceSettings.profileId || "(unnamed)"}`,
            "Termux answered with a token of its own for this vault. Other vaults keep their own profiles and tokens."
          ]).open();
          return;
        }
      }
      if (Date.now() >= deadline) break;
    }
    new ResultModal(
      this.app,
      "No answer from Termux yet",
      [
        "The pairing request is written and stays there; the runner picks it up on its next run.",
        "If nothing happens: Termux must be installed and the runner already set up once (the install command below does that), and the companion app needs its RUN_COMMAND permission."
      ],
      {
        isError: true,
        actions: [
          {
            label: "Copy command & open Termux",
            cta: true,
            keepOpen: true,
            onClick: () => this.copyCommandAndOpenTermux()
          }
        ]
      }
    ).open();
  }
  /**
   * Repositories set aside by a re-clone, read from the manifests the runner
   * writes next to them. No Termux round trip and no walking of a large
   * directory: the manifest is a few hundred bytes.
   */
  async listPreviousRepos() {
    const root = new RuntimePaths(this.app.vault.configDir).root;
    const out = [];
    try {
      const listing = await this.app.vault.adapter.list(root);
      for (const f of listing.files) {
        const name = f.slice(f.lastIndexOf("/") + 1);
        if (!name.startsWith(PREVIOUS_GIT_PREFIX) || !name.endsWith(".json")) continue;
        const parsed = parsePreviousRepo(await this.app.vault.adapter.read(f));
        if (parsed) out.push(parsed);
      }
    } catch {
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  /**
   * Once a day, if a re-clone left a repository behind, say so.
   *
   * It is invisible (inside a dot-folder inside the config directory) and it
   * can be hundreds of megabytes on a vault of a few thousand files. Nobody
   * goes looking for it; the plugin that created it should be the one to
   * mention it — once a day, never twice in a session, and never again about a
   * copy the user has decided to keep.
   */
  async remindAboutPreviousRepos() {
    const repos = await this.listPreviousRepos();
    if (repos.length === 0) return;
    const s = this.deviceSettings;
    const due = reposToRemindAbout(repos, {
      lastRemindedAt: s.previousRepoRemindedAt,
      dismissed: s.previousRepoDismissed
    });
    if (due.length === 0) return;
    await this.updateDeviceSettings({ previousRepoRemindedAt: Date.now() });
    this.showPreviousRepoModal(due, "A previous repository is still taking up space");
  }
  /** The reminder and the settings entry share one window. */
  showPreviousRepoModal(repos, title) {
    const root = new RuntimePaths(this.app.vault.configDir).root;
    const total = repos.reduce((n, r) => n + r.sizeKb, 0);
    const lines = [
      repos.length === 1 ? "Re-cloning this vault put the repository it replaced aside instead of deleting it, because it may hold commits that exist nowhere else." : `Re-cloning this vault put ${repos.length} earlier repositories aside instead of deleting them.`,
      "",
      ...repos.map((r) => `${r.dir} \u2014 ${describePreviousRepo(r)}${r.lastCommit ? `, last: ${r.lastCommit}` : ""}`),
      "",
      `Total: ${formatSize(total)}, in ${root}/`,
      "",
      "Keeping it costs only disk. Deleting it is final: any commit that exists only there goes with it. To look inside first, in Termux:",
      `git -C <vault> remote add previous <vault>/${root}/${repos[0]?.dir ?? ""}`,
      "git -C <vault> fetch previous     # then browse previous/<branch>"
    ];
    const actions = [
      {
        label: repos.length === 1 ? "Delete it" : "Delete all of them",
        onClick: () => this.confirmDeletePreviousRepos(repos)
      },
      {
        label: "Keep, remind me tomorrow",
        cta: true,
        onClick: () => void 0
      },
      {
        label: "Keep, stop reminding",
        onClick: () => {
          void this.updateDeviceSettings({
            previousRepoDismissed: [
              ...this.deviceSettings.previousRepoDismissed,
              ...repos.map((r) => r.dir)
            ]
          });
          this.notify("The old repository stays; no more reminders about it.");
        }
      }
    ];
    new ResultModal(this.app, title, lines, { actions }).open();
  }
  confirmDeletePreviousRepos(repos) {
    const total = repos.reduce((n, r) => n + r.sizeKb, 0);
    const commits = repos.reduce((n, r) => n + r.commits, 0);
    new ConfirmModal(
      this.app,
      {
        title: "Delete the old repository?",
        body: [
          `${repos.length === 1 ? "One repository" : `${repos.length} repositories`}, ${formatSize(total)}, ${commits} commit${commits === 1 ? "" : "s"} in total.`,
          "Only the history goes: your notes are the files in the vault and are not touched.",
          "This cannot be undone from here. Any commit that exists only in this copy \u2014 anything never pushed \u2014 is gone with it."
        ],
        confirmLabel: "Delete permanently",
        icon: "trash",
        danger: true
      },
      async (confirmed) => {
        if (!confirmed) return;
        const root = new RuntimePaths(this.app.vault.configDir).root;
        const failed = [];
        for (const r of repos) {
          try {
            await this.app.vault.adapter.rmdir(`${root}/${r.dir}`, true);
            await this.app.vault.adapter.remove(`${root}/${r.dir}.json`);
          } catch (e) {
            failed.push(r.dir);
            this.log.add("error", "clone", `Could not delete ${r.dir}: ${String(e)}`);
          }
        }
        if (failed.length > 0) {
          new ResultModal(
            this.app,
            "Some copies could not be deleted",
            [...failed, `Delete them by hand in Termux: rm -rf <vault>/${root}/previous-git-*`],
            { isError: true }
          ).open();
          return;
        }
        this.notify(`Freed ${formatSize(total)}.`);
      }
    ).open();
  }
  /**
   * Does this vault hold a repository? Answered from the vault itself, without
   * a Termux round trip: `.git` is either a directory (normal) or a file (a
   * worktree link). Used to decide which bootstrap steps make sense.
   */
  async vaultHasRepository() {
    try {
      return await this.app.vault.adapter.exists(".git");
    } catch {
      return false;
    }
  }
  /**
   * "Set up the repository for this vault": the missing beginning of the
   * story, in the same shape as the setup guide — a short list of steps, one
   * action each, decided from what this vault actually is right now.
   */
  async cmdSetupRepository() {
    if (!import_obsidian15.Platform.isAndroidApp) {
      new import_obsidian15.Notice("Native Git Bridge works on Android only (it delegates git to Termux).");
      return;
    }
    const s = this.deviceSettings;
    const hasRepo = await this.vaultHasRepository();
    const paired = s.authToken !== "";
    const lines = [];
    const actions = [];
    lines.push(
      hasRepo ? "This vault is a git repository." : "This vault is NOT a git repository yet.",
      `Paired with Termux: ${paired ? `yes (${s.profileId || "profile unknown"})` : "no"}`,
      ""
    );
    if (!paired) {
      lines.push(
        "Termux has to know this vault before it can do anything here. Pairing works even before the repository exists.",
        "1. Pair this vault (Termux generates the token and answers).",
        "2. Then come back here to create or clone the repository."
      );
      actions.push({
        label: "Pair this vault",
        cta: true,
        keepOpen: true,
        onClick: () => void this.cmdPairThisVault()
      });
      new ResultModal(this.app, "Set up the repository", lines, { actions }).open();
      return;
    }
    if (!hasRepo) {
      lines.push(
        "Two ways to give it one:",
        "\u2022 Start fresh \u2014 create an empty repository here and, if you want, commit what the vault already contains. You can add a remote afterwards.",
        "\u2022 Clone an existing one \u2014 the vault keeps the files it already has; anything that exists on both sides is reported and you decide, nothing is overwritten silently.",
        "",
        "Credentials never come through the plugin. Set them up once in Termux (a credential helper, an SSH key, or `gh auth login`) \u2014 see docs/setup.md."
      );
      actions.push(
        { label: "Create a repository here", cta: true, keepOpen: true, onClick: () => this.promptInitRepo() },
        { label: "Clone from a remote", keepOpen: true, onClick: () => this.promptClone() }
      );
    } else {
      lines.push(
        `Remote, as of the last status: ${this.lastRemoteUrl || "not seen yet \u2014 run Status to find out"}`,
        "",
        "Fetch, pull and push need one. Set it if the repository has none, or change it if it moved or was set up with the wrong account."
      );
      actions.push({
        label: this.lastRemoteUrl ? "Change the remote" : "Add a remote",
        cta: true,
        keepOpen: true,
        onClick: () => this.promptSetRemote()
      });
      actions.push({
        label: "Re-clone from a remote",
        keepOpen: true,
        onClick: () => this.promptClone(true)
      });
    }
    new ResultModal(this.app, "Set up the repository", lines, { actions }).open();
  }
  promptInitRepo() {
    new CommitMessageModal(
      this.app,
      {
        title: "Create a repository in this vault",
        placeholder: "main",
        submitLabel: "Create repository",
        initial: "main"
      },
      (branch) => {
        if (branch === null) return;
        if (!isValidBranchName(branch)) {
          new ResultModal(this.app, "Invalid branch name", [
            `'${branch}' is not a branch name this plugin will send.`,
            "Letters, digits, dot, dash, underscore and slash; no '..', no leading dash."
          ], { isError: true }).open();
          return;
        }
        new ConfirmModal(
          this.app,
          {
            title: "Commit what is here?",
            body: [
              `A new repository on branch '${branch}' will be created in this vault.`,
              "Confirm to also make a first commit containing every file the vault currently holds (the plugin's runtime folder is excluded automatically).",
              "Decline to create the repository empty and commit later, after reviewing what is in it."
            ],
            confirmLabel: "Create and commit everything",
            icon: "check"
          },
          async (commitAll) => {
            const result = await this.runOperation("init-repo", {
              branch,
              initialCommit: commitAll,
              message: "Initial commit (native git bridge)"
            });
            if (!result) return;
            if (!result.ok) return this.renderMutationError("Native Git: init failed", result);
            this.absorbStatusData(result.data ?? {});
            new ResultModal(this.app, "Repository created", [
              `Branch: ${result.data?.branch ?? branch}`,
              result.data?.committed === "true" ? "The vault's files are in the first commit." : "Nothing is committed yet.",
              "Next: add a remote, then push."
            ], {
              actions: [
                { label: "Add a remote", cta: true, keepOpen: true, onClick: () => this.promptSetRemote() }
              ]
            }).open();
          }
        ).open();
      }
    ).open();
  }
  promptSetRemote() {
    new CommitMessageModal(
      this.app,
      {
        title: "Remote for this vault",
        placeholder: "https://github.com/you/vault.git",
        submitLabel: "Save remote",
        initial: ""
      },
      async (raw) => {
        if (raw === null) return;
        const verdict = validateRemoteUrl(raw);
        if (!verdict.ok) {
          new ResultModal(this.app, "That URL cannot be used", [verdict.reason ?? "Invalid URL."], {
            isError: true
          }).open();
          return;
        }
        const result = await this.runOperation("set-remote", { url: verdict.url });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: set remote failed", result);
        this.absorbStatusData(result.data ?? {});
        this.afterRemoteSet(verdict.url, result.data ?? {});
      }
    ).open();
  }
  promptClone(replaceExisting = false) {
    if (replaceExisting) {
      new ConfirmModal(
        this.app,
        {
          title: "Replace this vault's repository?",
          body: [
            "The repository will be cloned again from a remote you give next.",
            "Your notes are not touched: files that exist on both sides keep your version and show up as local changes, files that exist only here stay untracked.",
            "The repository that is here now is NOT deleted \u2014 it is set aside in the plugin's runtime folder, with its history intact, and you decide later what to do with it.",
            "Nothing happens until the clone succeeds: a clone that fails leaves everything exactly as it is."
          ],
          confirmLabel: "Choose the remote",
          icon: "download"
        },
        (confirmed) => {
          if (confirmed) this.askCloneUrl(true);
        }
      ).open();
      return;
    }
    this.askCloneUrl(false);
  }
  askCloneUrl(replaceExisting) {
    new CommitMessageModal(
      this.app,
      {
        title: "Clone into this vault",
        placeholder: "https://github.com/you/vault.git",
        submitLabel: "Clone",
        initial: ""
      },
      (raw) => {
        if (raw === null) return;
        const verdict = validateRemoteUrl(raw);
        if (!verdict.ok) {
          new ResultModal(this.app, "That URL cannot be used", [verdict.reason ?? "Invalid URL."], {
            isError: true
          }).open();
          return;
        }
        void this.runClone(verdict.url, replaceExisting);
      }
    ).open();
  }
  /**
   * Clone into a vault that already holds files.
   *
   * Nothing the vault already has is written over: the repository's tree goes
   * into the index, everything the vault does not have is written out of it,
   * and the files that exist on both sides stay as they are and appear in the
   * panel as ordinary local changes. So the decision the user faces is not a
   * blind "keep mine or take theirs" before they can see anything — it is the
   * per-file one they already know, with a diff, after the fact.
   */
  /**
   * Setting a remote is where the two ways of attaching a repository either
   * converge or part company, so this is the moment to say which one happened.
   *
   * A vault whose repository was created here has a history of its own. If the
   * remote also has one, the two are unrelated and git will refuse to merge
   * them later, with a message that arrives far too late to be useful. If the
   * local repository has no commits yet, the remote's history can simply be
   * taken over, which lands in exactly the state cloning would have produced.
   */
  afterRemoteSet(url, d) {
    const shown = redactRemoteUrl(url);
    const remoteBranches = (d.remoteBranches ?? "").split("\n").filter((b) => b.trim() !== "");
    const localCommits = d.localCommits === "true";
    if (d.remoteReachable !== "true") {
      new ResultModal(this.app, "Remote saved", [
        `Origin is now ${shown}.`,
        "It could not be reached just now, so there is nothing more to say about it yet \u2014 usually credentials that are not set up in Termux, or no connection. Run Fetch once they are."
      ]).open();
      return;
    }
    if (remoteBranches.length === 0) {
      new ResultModal(this.app, "Remote saved", [
        `Origin is now ${shown}.`,
        "The remote is empty, so this vault's history will be the first thing in it. Commit, then push."
      ]).open();
      return;
    }
    if (!localCommits) {
      new ResultModal(
        this.app,
        "Remote saved \u2014 it already has content",
        [
          `Origin is now ${shown}, and it already contains: ${remoteBranches.join(", ")}.`,
          "This vault has no commits yet, so it can simply take that history over. Your existing files are kept: the ones that also exist in the repository become ordinary local changes, and the rest of the repository is checked out around them \u2014 the same result cloning would have given."
        ],
        {
          actions: [
            {
              label: "Get the repository's content",
              cta: true,
              onClick: () => void this.runAdoptRemote()
            }
          ]
        }
      ).open();
      return;
    }
    new ResultModal(
      this.app,
      "Remote saved \u2014 but the two histories are unrelated",
      [
        `Origin is now ${shown}, and it already contains: ${remoteBranches.join(", ")}.`,
        "This vault also has commits of its own, made here. Git treats the two as unrelated histories: pull will refuse to merge them, and push will be rejected. Nothing is broken \u2014 but they cannot simply be joined.",
        "",
        "The clean way out: open a NEW empty vault and clone the repository into it, then move your notes across.",
        "The deliberate way: in Termux, either `git pull --allow-unrelated-histories` (keeps both, expect conflicts) or reset onto the remote branch (throws your local commits away). This plugin does neither for you."
      ],
      { isError: true }
    ).open();
  }
  /** Take an already configured remote's history into a repository with none. */
  async runAdoptRemote() {
    const result = await this.runOperation("adopt-remote", {});
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: could not take the remote's content", result);
    this.absorbStatusData(result.data ?? {});
    const collisions = (result.data?.collisions ?? "").split("\n").filter((l) => l.trim() !== "");
    const lines = [`Branch: ${result.data?.branch ?? "(unknown)"}`];
    if (collisions.length === 0) {
      lines.push("The repository's files are in the vault. Nothing you already had was touched.");
    } else {
      lines.push(
        `${collisions.length} file${collisions.length === 1 ? "" : "s"} existed here as well; your versions were kept and now show in the panel as local changes:`,
        ...collisions.slice(0, 10),
        collisions.length > 10 ? `\u2026and ${collisions.length - 10} more` : ""
      );
    }
    new ResultModal(this.app, "Repository content taken over", lines.filter((l) => l !== "")).open();
  }
  async runClone(url, replaceExisting = false) {
    const args = { url };
    if (replaceExisting) args.replaceExisting = true;
    const result = await this.runOperation("clone-into-vault", args);
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: clone failed", result);
    this.absorbStatusData(result.data ?? {});
    const collisions = (result.data?.collisions ?? "").split("\n").filter((l) => l.trim() !== "");
    const lines = [`Branch: ${result.data?.branch || "(unborn)"}`];
    if (result.data?.empty === "true") {
      lines.push("The remote is empty; the vault is linked to it and ready for a first commit.");
    } else if (collisions.length === 0) {
      lines.push("The repository's files are in the vault. Nothing you already had was touched.");
    } else {
      lines.push(
        `The repository's files are in the vault, and ${collisions.length} of them also existed here.`,
        "Your versions were kept \u2014 they now show in the panel as local changes:",
        ...collisions.slice(0, 10),
        collisions.length > 10 ? `\u2026and ${collisions.length - 10} more` : "",
        "",
        "Open each one to see the difference, then commit to keep yours or discard to take the repository's version. Files that exist only here were left alone and are simply untracked."
      );
    }
    if (result.data?.previousGit) {
      lines.push(
        "",
        `The repository that was here is not deleted \u2014 it is set aside as ${result.data.previousGit} in the plugin's runtime folder. The plugin will remind you about the disk it uses; delete it once you are sure nothing in it is needed.`
      );
    }
    if (result.data?.configDirTracked === "true" && result.data?.empty !== "true") {
      lines.push(
        "",
        `This repository also tracks ${this.app.vault.configDir}/. Restart Obsidian now: it read the old configuration when it started and can overwrite parts of it from memory until you do. Plugins that arrived with the clone appear only after the restart.`
      );
    }
    new ResultModal(this.app, "Repository cloned", lines.filter((l) => l !== "")).open();
  }
  async reconcileAfterRestart() {
    const raw = this.store.getValue(MARKER_KEY);
    if (!raw) {
      await this.client.cleanupOld();
      return;
    }
    let marker = null;
    try {
      marker = JSON.parse(raw);
    } catch {
    }
    this.store.removeValue(MARKER_KEY);
    if (!marker) return;
    const outcome = await this.client.awaitResult(marker.id, 1, void 0);
    if (outcome.kind === "result") {
      this.log.add(
        "info",
        marker.action,
        `Recovered result for operation ${marker.id} finished while Obsidian was closed (ok=${outcome.result.ok}).`
      );
      await this.client.consume(marker.id);
    } else if (isMarkerStale(marker)) {
      this.log.add("warn", marker.action, `Cleared stale operation lock ${marker.id} from a previous session.`);
    } else {
      this.log.add(
        "warn",
        marker.action,
        `Operation ${marker.id} from the previous session has no result yet; it may still be running in Termux. Its result will be cleaned up automatically.`
      );
    }
    await this.client.cleanupOld();
  }
  persistMarker(marker) {
    if (marker) this.store.setValue(MARKER_KEY, JSON.stringify(marker));
    else this.store.removeValue(MARKER_KEY);
  }
  // -------------------------------------------------------------- settings
  async updateDeviceSettings(patch) {
    this.deviceSettings = this.store.write(patch);
    this.refreshStatusBarIdle();
  }
  async resetDeviceSettings() {
    this.store.reset();
    this.deviceSettings = this.store.read();
    this.refreshStatusBarIdle();
    new import_obsidian15.Notice("Native Git Bridge: device-local settings reset.");
  }
  refreshStatusBarIdle() {
    if (!this.statusBar) return;
    if (!this.deviceSettings.enabledOnThisDevice) this.statusBar.set("disabled");
    else if (this.lock.active) this.statusBar.set("syncing");
    else if (this.lastStatus) this.applyStatusToStatusBar(this.lastStatus.status);
    else this.statusBar.set("clean");
  }
  applyStatusToStatusBar(s) {
    if (!this.statusBar) return;
    if (s.conflicted.length > 0) this.statusBar.set("conflict", `(${s.conflicted.length})`);
    else if (s.staged.length + s.unstaged.length + s.untracked.length > 0)
      this.statusBar.set("changed", `(${s.staged.length + s.unstaged.length + s.untracked.length})`);
    else this.statusBar.set("clean", s.ahead > 0 ? `\u2191${s.ahead}` : void 0);
  }
  // -------------------------------------------------------------- commands
  registerCommands() {
    const cmds = [
      // Obsidian already prefixes every entry with the plugin name, so a
      // "Native Git: " here produced "Native Git Bridge: Native Git: Fetch".
      // Ids stay untouched: they are what user hotkeys are bound to.
      { id: "status", name: "Status", cb: () => void this.cmdStatus() },
      { id: "pull", name: "Pull", cb: () => void this.cmdPull() },
      { id: "push", name: "Push", cb: () => void this.cmdPush() },
      { id: "commit", name: "Commit", cb: () => void this.cmdCommit() },
      { id: "sync", name: "Sync", cb: () => void this.cmdSync() },
      { id: "fetch", name: "Fetch", cb: () => void this.cmdFetch() },
      { id: "stage-all", name: "Stage all changes", cb: () => void this.cmdStageAll() },
      { id: "unstage-all", name: "Unstage all changes", cb: () => void this.cmdUnstageAll() },
      { id: "discard-all", name: "Discard all local changes (keep staged)", cb: () => this.cmdDiscardAll() },
      { id: "reset-all", name: "Reset everything to HEAD (staged and local changes)", cb: () => this.cmdResetAll() },
      { id: "show-history-current-file", name: "Show history for current file", cb: () => this.cmdFileHistory() },
      { id: "show-diff-current-file", name: "Show diff for current file", cb: () => void this.cmdDiffCurrentFile() },
      { id: "show-file-at-commit", name: "Show current file at a commit", cb: () => this.cmdFileHistory() },
      { id: "restore-file-from-commit", name: "Restore current file from a commit", cb: () => this.cmdFileHistory() },
      { id: "show-changed-files", name: "Show changed files", cb: () => void this.cmdShowChangedFiles() },
      { id: "verify-sparse-safety", name: "Verify sparse checkout safety", cb: () => void this.cmdVerifySparseSafety() },
      { id: "reapply-sparse", name: "Reapply sparse checkout", cb: () => void this.cmdReapplySparse() },
      { id: "diagnostics", name: "Run diagnostics", cb: () => void this.cmdDiagnostics() },
      { id: "open-operation-log", name: "Open operation log", cb: () => new OperationLogModal(this.app, this.log).open() },
      { id: "open-status-panel", name: "Open status panel", cb: () => void this.openStatusPanel() },
      { id: "open-history-panel", name: "Open history panel", cb: () => void this.openHistoryPanel() },
      { id: "open-file-history-panel", name: "Open history panel for the current file", cb: () => {
        const p = this.activeFilePath();
        if (p !== null) void this.openFileHistoryPanel(p);
      } },
      { id: "bridge-self-check", name: "Check bridge (no Termux round trip)", cb: () => void this.cmdSelfCheck() },
      { id: "open-companion-setup", name: "Open companion app setup", cb: () => void this.openCompanionSetup() },
      { id: "setup-guide", name: "Setup guide (Termux, companion, pairing)", cb: () => this.openSetupGuide("Setup guide.") },
      { id: "pair-this-vault", name: "Pair this vault with Termux", cb: () => void this.cmdPairThisVault() },
      { id: "setup-repository", name: "Set up the repository for this vault", cb: () => void this.cmdSetupRepository() },
      { id: "cancel-operation", name: "Cancel current operation when possible", cb: () => void this.cmdCancel() }
    ];
    for (const c of cmds) this.addCommand({ id: c.id, name: c.name, callback: c.cb });
    this.registerObsidianProtocolHandler("native-git-bridge-ack", (params) => {
      const p = params;
      this.onCompanionAck(p?.src, p?.termux, p?.cv);
    });
  }
  // ------------------------------------------------------------ operations
  /** Guard + queue + trigger + await one bridge operation. */
  async runOperation(action, args = {}) {
    const s = this.deviceSettings;
    if (!import_obsidian15.Platform.isAndroidApp) {
      new import_obsidian15.Notice(
        "Native Git Bridge works on Android only (it delegates git to Termux). On desktop, use git directly or the obsidian-git plugin."
      );
      return null;
    }
    if (!s.enabledOnThisDevice) {
      this.openSetupGuide("Native Git Bridge is not enabled on this device yet.");
      return null;
    }
    if (!s.termuxIntegrationEnabled) {
      this.openSetupGuide("Termux integration is switched off on this device.");
      return null;
    }
    if (!s.authToken) {
      this.openSetupGuide("This device is not paired with a Termux runner yet.");
      return null;
    }
    const needsRunner = ACTION_MIN_RUNNER.get(action);
    if (this.lastRunnerVersion > 0 && needsRunner !== void 0 && this.lastRunnerVersion < needsRunner) {
      new ResultModal(
        this.app,
        "Termux runner is too old for this action",
        [
          `'${action}' needs runner v${needsRunner}; this device answers with v${this.lastRunnerVersion}.`,
          RUNNER_OUTDATED_HINT
        ],
        {
          isError: true,
          actions: [
            {
              label: "Copy command & open Termux",
              cta: true,
              keepOpen: true,
              onClick: () => this.copyCommandAndOpenTermux()
            }
          ]
        }
      ).open();
      return null;
    }
    const req = createRequest(
      action,
      args,
      s.authToken,
      ACTION_TIMEOUT_SECONDS[action] ?? s.opTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
      /* @__PURE__ */ new Date(),
      randomSuffix(),
      s.profileId
    );
    const mutating = MUTATING_ACTIONS.has(action);
    if (mutating && !this.lock.tryAcquire(req.id, action)) {
      new import_obsidian15.Notice(`Another operation is running (${this.lock.active?.action}). Try again later.`);
      return null;
    }
    if (!mutating && this.lock.active && MUTATING_ACTIONS.has(this.lock.active.action)) {
      new import_obsidian15.Notice(`A ${this.lock.active.action} operation is running; try again when it finishes.`);
      return null;
    }
    const cancel = new CancelToken();
    this.activeCancel = cancel;
    this.statusBar?.set("syncing");
    this.pushStatusToView();
    this.log.add("info", action, `Queued request ${req.id}.`);
    void this.openStatusPanel(false);
    const startedAt = Date.now();
    this.runningAction = action;
    this.runningPath = typeof args["path"] === "string" ? args["path"] : null;
    this.progressText = `${action}\u2026 0s`;
    this.pushStatusToView();
    const ticker = window.setInterval(() => {
      const secs = Math.round((Date.now() - startedAt) / 1e3);
      this.progressText = `${action}\u2026 ${secs}s`;
      this.updateProgressInView(this.progressText);
    }, 1e3);
    try {
      await this.client.submit(req);
      const ackBaseline = this.lastCompanionAckMs;
      this.makeTransport().trigger(req.id);
      const waited = await this.client.awaitResult(req.id, req.timeoutSeconds * 1e3, cancel);
      if (waited.kind === "timeout") {
        await this.client.requestCancel(req.id);
        this.log.add(
          "warn",
          action,
          `Request ${req.id} timed out after ${req.timeoutSeconds}s (cancel flag written to prevent late execution).`
        );
        await this.cmdSelfCheck(true);
        if (this.lastCompanionAckMs > ackBaseline) {
          this.log.add(
            "warn",
            action,
            "Companion acknowledged the trigger but no result arrived: the problem is on the Termux/runner side (see the bridge check)."
          );
        } else if (!this.companionSetupAutoOpened) {
          this.companionSetupAutoOpened = true;
          void this.openCompanionSetup();
        }
        return null;
      }
      if (waited.kind === "cancelled") {
        await this.client.requestCancel(req.id);
        this.log.add("warn", action, `Request ${req.id} cancelled by user.`);
        new import_obsidian15.Notice(`Native Git: ${action} cancelled.`);
        return null;
      }
      const result = waited.result;
      await this.client.consume(req.id);
      this.checkRunnerVersion(result);
      await this.learnProfileId(result);
      this.log.add(
        result.ok ? "info" : "error",
        action,
        `Request ${req.id} finished ok=${result.ok} exit=${result.exitCode}.`,
        result.error ? `${result.error.code}: ${result.error.message}` : void 0
      );
      return result;
    } catch (e) {
      this.log.add("error", action, `Bridge error: ${String(e)}`);
      new ResultModal(this.app, `Native Git: ${action} failed`, [String(e)], { isError: true }).open();
      return null;
    } finally {
      window.clearInterval(ticker);
      this.progressText = null;
      this.runningAction = null;
      this.runningPath = null;
      this.activeCancel = null;
      if (mutating) this.lock.release(req.id);
      this.refreshStatusBarIdle();
      this.pushStatusToView();
    }
  }
  checkRunnerVersion(result) {
    const version = typeof result.runnerVersion === "number" ? result.runnerVersion : 1;
    if (typeof result.runnerVersion === "number" && result.runnerVersion !== this.lastRunnerVersion) {
      this.lastRunnerVersion = result.runnerVersion;
      this.store.setValue("last-runner-version", String(result.runnerVersion));
    }
    if (version >= RUNNER_MIN_VERSION || this.runnerVersionWarned) return;
    this.runnerVersionWarned = true;
    this.log.add("warn", "compat", `Runner version ${version} < required ${RUNNER_MIN_VERSION}.`);
    new ResultModal(
      this.app,
      "Termux runner is outdated",
      [
        `Runner version: ${version} \u2014 this plugin needs ${RUNNER_MIN_VERSION}.`,
        RUNNER_OUTDATED_HINT
      ],
      { isError: true }
    ).open();
  }
  makeTransport() {
    return new CompanionIntentTransport(
      this.deviceSettings.companionUriTemplate,
      (uri) => this.openExternalUri(uri)
    );
  }
  /**
   * Open an https URL the most reliable way available.
   *
   * Obsidian routes https to a Chrome Custom Tab, whose download session is
   * ephemeral — APK downloads started there frequently never reach Downloads.
   * The companion, being a real app, can fire a plain ACTION_VIEW that lands
   * in the default browser, where downloads behave normally. So: if a
   * companion has answered at least once, ask IT to open the URL; otherwise
   * fall back to Obsidian's own handling.
   *
   * `companionUri` must be a fixed companion host (the URL itself lives in the
   * companion), which keeps the "URI carries intent, never payload" property.
   */
  openUrlPreferCompanion(companionUri, directUrl) {
    if (this.lastCompanionAckMs > 0) this.openExternalUri(companionUri);
    else this.openExternalUri(directUrl);
  }
  openExternalUri(uri) {
    let opened = null;
    try {
      opened = window.open(uri);
    } catch {
      opened = null;
    }
    if (!opened) {
      const a = activeDocument.body.createEl("a", { href: uri, attr: { rel: "noopener" } });
      a.click();
      a.remove();
    }
  }
  /**
   * The companion (>= 0.4.0) bounces obsidian://native-git-bridge-ack back for
   * every URI it receives, giving a DETERMINISTIC "companion is installed and
   * reachable" signal — and, since 0.4.1, whether Termux itself is installed
   * (the WebView cannot query other packages; the companion can). Registered
   * in onload.
   */
  onCompanionAck(src, termux, companionVersion) {
    this.lastCompanionAckMs = Date.now();
    if (termux === "1") this.lastAckTermuxInstalled = true;
    else if (termux === "0") this.lastAckTermuxInstalled = false;
    if (companionVersion && /^[0-9.]{1,16}$/.test(companionVersion)) {
      this.lastCompanionVersion = companionVersion;
      this.store.setValue("last-companion-version", companionVersion);
    }
    this.log.add(
      "info",
      "companion",
      `Companion acknowledged (${src ?? "unknown"}; Termux installed: ${termux === "1" ? "yes" : termux === "0" ? "NO" : "unknown"}).`
    );
    for (const w of this.ackWaiters.splice(0)) w();
  }
  awaitCompanionAck(timeoutMs) {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        const i = this.ackWaiters.indexOf(waiter);
        if (i >= 0) this.ackWaiters.splice(i, 1);
        resolve(false);
      }, timeoutMs);
      const waiter = () => {
        window.clearTimeout(timer);
        resolve(true);
      };
      this.ackWaiters.push(waiter);
    });
  }
  /**
   * Secondary signal: the WebView losing visibility when another activity
   * comes to the front. Kept alongside the ack because a pre-0.4.0 companion
   * never acks — visibility is the only evidence it opened. Noisy by nature
   * (Obsidian goes background for many reasons), which is why the ack, when
   * available, decides first.
   */
  awaitAppSwitch() {
    return new Promise((resolve) => {
      if (document.visibilityState === "hidden") return resolve(true);
      const onChange = () => {
        cleanup();
        resolve(true);
      };
      const timer = window.setTimeout(() => {
        cleanup();
        resolve(false);
      }, this.companionProbeMs);
      const cleanup = () => {
        window.clearTimeout(timer);
        document.removeEventListener("visibilitychange", onChange);
      };
      document.addEventListener("visibilitychange", onChange);
    });
  }
  /** True when the companion showed any sign of life within the probe window. */
  async probeCompanion() {
    return new Promise((resolve) => {
      let misses = 0;
      const done = (alive) => {
        if (alive) resolve(true);
        else if (++misses === 2) resolve(false);
      };
      void this.awaitCompanionAck(this.companionProbeMs).then(done);
      void this.awaitAppSwitch().then(done);
    });
  }
  /**
   * Open the companion app's setup checklist. When nothing opens (no handler
   * for the scheme), the companion is not installed — explain and hand the
   * user the APK download link.
   */
  async openCompanionSetup() {
    if (!import_obsidian15.Platform.isAndroidApp) {
      new import_obsidian15.Notice("The companion app exists only on Android.");
      return;
    }
    this.log.add("info", "companion", "Opening companion setup checklist.");
    const q = `?pv=${encodeURIComponent(this.manifest.version)}&rv=${this.lastRunnerVersion}&rmin=${RUNNER_MIN_VERSION}`;
    this.openExternalUri(COMPANION_SETUP_URI + q);
    if (await this.probeCompanion()) return;
    this.log.add("warn", "companion", "Setup URI opened nothing - companion app likely not installed.");
    new ResultModal(
      this.app,
      "Companion app not installed?",
      [
        "Nothing opened, which usually means the Git Bridge Companion app is not installed on this device.",
        "The companion is the only supported trigger: it holds the Android permission to run the Termux runner. Without it, requests just time out.",
        "Copy the link below and paste it into your browser (Chrome/Firefox). That is the reliable route here: with no companion installed, Obsidian can only open its built-in browser tab, whose downloads are often discarded when the tab closes \u2014 so the APK never reaches Downloads.",
        `Latest release (companion APK): ${COMPANION_RELEASES_URL}`,
        "After installing, grant the 'Run commands in Termux environment' permission in the companion, then try again."
      ],
      {
        actions: [
          {
            label: "Copy download link",
            cta: true,
            keepOpen: true,
            onClick: () => {
              void navigator.clipboard.writeText(COMPANION_RELEASES_URL);
              new import_obsidian15.Notice("Release link copied - open it in Chrome or Firefox and download the APK there.");
            }
          },
          {
            label: "Try opening in browser",
            keepOpen: true,
            onClick: () => this.openUrlPreferCompanion(COMPANION_DOWNLOAD_APK_URI, COMPANION_RELEASES_URL)
          }
        ]
      }
    ).open();
  }
  // ------------------------------------------------------------- command impls
  async cmdStatus(silent = false) {
    const result = await this.runOperation("status");
    if (!result) return;
    if (!result.ok) {
      this.statusBar?.set("error");
      new ResultModal(
        this.app,
        "Native Git: status failed",
        [result.error?.message ?? "Unknown error."],
        { stdout: result.error?.stdout, stderr: result.error?.stderr, isError: true }
      ).open();
      return;
    }
    const d = result.data ?? {};
    const status = parseStatusPorcelainV2(d.branchInfo ?? "");
    if (d.untrackedChildren !== void 0)
      status.untrackedChildren = groupUntrackedChildren(d.untrackedChildren, status.untracked);
    const sparse = parseSparseState({
      sparseEnabled: d.sparseEnabled ?? "",
      sparseCone: d.sparseCone ?? "",
      sparseList: d.sparseList ?? "",
      skipWorktreeCount: d.skipWorktreeCount,
      lsFilesV: d.lsFilesV
    });
    const lastCommit = parseLastCommit(d.lastCommit ?? "");
    this.absorbSparsePatterns(sparse);
    this.lastStatus = { status, sparse, lastCommit, fetchedAt: (/* @__PURE__ */ new Date()).toLocaleString() };
    this.applyStatusToStatusBar(status);
    this.pushStatusToView();
    if (!silent) this.openStatusModal();
  }
  openStatusModal() {
    new StatusModal(this.app, {
      status: this.lastStatus?.status,
      sparse: this.lastStatus?.sparse,
      lastCommit: this.lastStatus?.lastCommit,
      lastSyncAt: this.store.getValue(LAST_SYNC_KEY) ?? void 0,
      bridgeAvailable: this.deviceSettings.termuxIntegrationEnabled ? "enabled (companion app)" : "disabled",
      activeOperation: this.lock.active ? this.lock.active.action : void 0,
      fetchedAt: this.lastStatus?.fetchedAt
    }).open();
  }
  async cmdShowChangedFiles() {
    if (!this.lastStatus) {
      await this.cmdStatus(true);
    }
    if (this.lastStatus) {
      new ChangedFilesModal(this.app, this.lastStatus.status, this.lastStatus.fetchedAt).open();
    }
  }
  async cmdVerifySparseSafety() {
    const protectedPaths = this.effectiveProtectedPaths();
    if (protectedPaths.length === 0) {
      new import_obsidian15.Notice("No protected sparse paths configured (see settings).");
      return;
    }
    const result = await this.runOperation("verify-sparse-safety", { protectedPaths });
    if (!result) return;
    if (!result.ok) {
      new ResultModal(
        this.app,
        "Sparse safety check could not run",
        [result.error?.message ?? "Unknown error."],
        { stdout: result.error?.stdout, stderr: result.error?.stderr, isError: true }
      ).open();
      return;
    }
    const d = result.data ?? {};
    const report = evaluateSparseSafety(d.statusProtected ?? "", d.stagedProtected ?? "", protectedPaths);
    if (!report.safe) this.statusBar?.set("error");
    new SparseSafetyModal(this.app, report, SPARSE_SAFETY_WARNING, this.sparseSafetyFixes()).open();
  }
  /**
   * Move every listed path to Obsidian's trash, expanding folders into their
   * files first.
   *
   * Two reasons this is not a plain loop over `trashLocal`. git's porcelain
   * output collapses a fully untracked directory into a single `dir/` entry,
   * so one "file" in the list can be a folder holding many; and a path with
   * the trailing slash git prints is not a path the adapter recognises. The
   * old loop therefore trashed the first entry and quietly logged failures for
   * the rest, which looked like "only one file was deleted".
   */
  async trashAll(paths) {
    const adapter = this.app.vault.adapter;
    let moved = 0;
    const failed = [];
    const expand = async (raw) => {
      const p = raw.replace(/\/+$/, "");
      if (p === "") return [];
      let isFolder = false;
      try {
        const st = await adapter.stat(p);
        isFolder = st?.type === "folder";
      } catch {
        isFolder = false;
      }
      if (!isFolder) return [p];
      const out = [];
      try {
        const listing = await adapter.list(p);
        for (const f of listing.files) out.push(f);
        for (const d of listing.folders) out.push(...await expand(d));
      } catch (e) {
        this.log.add("warn", "sparse", `Could not list ${p}: ${String(e)}`);
      }
      out.push(p);
      return out;
    };
    const targets = [];
    for (const raw of paths) {
      for (const t of await expand(raw)) if (!targets.includes(t)) targets.push(t);
    }
    for (const t of targets) {
      try {
        await adapter.trashLocal(t);
        moved++;
      } catch (e) {
        let stillThere = true;
        try {
          stillThere = await adapter.exists(t);
        } catch {
          stillThere = true;
        }
        if (stillThere) {
          failed.push(t);
          this.log.add("error", "sparse", `Trash failed for ${t}: ${String(e)}`);
        }
      }
    }
    return { moved, failed };
  }
  /**
   * The two recoveries the safety modal offers. Both are explicit, confirmed
   * and reversible in the sense that matters: deleting goes to Obsidian's
   * trash rather than to `rm`, and unprotecting only edits sparse config, so
   * git history is never touched here.
   */
  sparseSafetyFixes() {
    return {
      deleteLocally: (paths) => {
        new ConfirmModal(
          this.app,
          {
            title: "Move these files to the trash?",
            body: [
              ...paths.slice(0, 12),
              paths.length > 12 ? `\u2026and ${paths.length - 12} more` : "",
              "They go to Obsidian's trash (.trash in the vault), so you can restore them from there. Git history is not touched."
            ].filter((l) => l !== ""),
            confirmLabel: "Move to trash",
            icon: "trash",
            danger: true
          },
          async (confirmed) => {
            if (!confirmed) return;
            const { moved, failed } = await this.trashAll(paths);
            if (failed.length > 0) {
              this.log.add(
                "error",
                "sparse",
                `${failed.length} path(s) could not be moved to the trash: ${failed.join(", ")}`
              );
              new ResultModal(
                this.app,
                "Some files could not be moved",
                [
                  `Moved ${moved} file${moved === 1 ? "" : "s"} to the trash; ${failed.length} could not be moved.`,
                  ...failed.slice(0, 12),
                  failed.length > 12 ? `\u2026and ${failed.length - 12} more` : "",
                  "The safety check below shows what is still there."
                ].filter((l) => l !== ""),
                { isError: true }
              ).open();
            } else {
              this.notify(`Moved ${moved} file${moved === 1 ? "" : "s"} to the trash.`);
            }
            await this.cmdVerifySparseSafety();
          }
        ).open();
      },
      unprotect: (dirs) => {
        new ConfirmModal(
          this.app,
          {
            title: "Stop protecting these directories?",
            body: [
              dirs.join(", "),
              "Their sparse exclusion is removed, so git checks them out again and their contents become ordinary tracked files that this device will commit and push.",
              "Protection is derived from the sparse rules, so they also disappear from the protected set."
            ],
            confirmLabel: "Remove exclusion",
            icon: "eye",
            danger: true
          },
          async (confirmed) => {
            if (!confirmed) return;
            for (const d of dirs) await this.cmdSparseExclude(d, false);
            await this.cmdStatus(true);
          }
        ).open();
      }
    };
  }
  /** Hide (exclude=true) or materialize a path via non-cone sparse patterns. */
  async cmdSparseExclude(path, exclude, skipConfirm = false) {
    const go = async () => {
      const result = await this.runOperation(exclude ? "sparse-exclude-add" : "sparse-exclude-remove", { path });
      if (!result) return;
      if (!result.ok) {
        new ResultModal(this.app, "Sparse change failed", [result.error?.message ?? "Unknown error."], {
          stdout: result.error?.stdout,
          stderr: result.error?.stderr,
          isError: true
        }).open();
        return;
      }
      this.absorbStatusData(result.data ?? {});
      new import_obsidian15.Notice(exclude ? `Hidden via sparse checkout: ${path}` : `Materialized again: ${path}`);
    };
    if (exclude && !skipConfirm) {
      new ConfirmModal(
        this.app,
        {
          title: "Hide via sparse checkout?",
          body: [
            `'${path}' will be removed from THIS device's working tree (git sparse-checkout exclusion).`,
            "Nothing is deleted from the repository or other devices, and the path automatically joins the protected set, so it can never be committed as a deletion from here."
          ],
          confirmLabel: "Hide on this device"
        },
        async (ok) => {
          if (ok) await go();
        }
      ).open();
    } else {
      await go();
    }
  }
  /** Add/remove a line in .git/info/exclude (device-local ignore, via the runner). */
  async cmdExcludeChange(path, add) {
    const result = await this.runOperation(add ? "exclude-add" : "exclude-remove", { path });
    if (!result) return;
    if (!result.ok) {
      new ResultModal(this.app, "Exclude change failed", [result.error?.message ?? "Unknown error."], {
        stdout: result.error?.stdout,
        stderr: result.error?.stderr,
        isError: true
      }).open();
      return;
    }
    this.absorbExcludeList(result.data?.excludeList);
    new import_obsidian15.Notice(add ? `Added to .git/info/exclude: /${path}` : `Removed from exclude: ${path}`);
  }
  async refreshExcludeList() {
    const result = await this.runOperation("exclude-list");
    if (!result?.ok) return null;
    this.absorbExcludeList(result.data?.excludeList);
    return this.excludeLines;
  }
  absorbExcludeList(raw) {
    if (raw === void 0) return;
    this.excludeLines = raw.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  }
  isExcluded(path) {
    return [`/${path}`, path, `/${path}/`, `${path}/`].some((v) => this.excludeLines.includes(v));
  }
  // .gitignore is a plain tracked file in the vault: edited directly, no Termux.
  async loadGitignore() {
    try {
      const raw = await this.app.vault.adapter.read(".gitignore");
      this.gitignoreLines = raw.split(/\r?\n/);
    } catch {
      this.gitignoreLines = [];
    }
    return this.gitignoreLines.filter((l) => l.trim() !== "");
  }
  isGitignored(path) {
    const variants = [`/${path}`, path, `/${path}/`, `${path}/`];
    return this.gitignoreLines.some((l) => variants.includes(l.trim()));
  }
  async gitignoreAdd(entry2) {
    if (entry2.trim() === "" || hasControlChars(entry2)) {
      new import_obsidian15.Notice("Invalid .gitignore entry.");
      return;
    }
    await this.loadGitignore();
    if (this.gitignoreLines.some((l) => l.trim() === entry2.trim())) return;
    while (this.gitignoreLines.length > 0 && this.gitignoreLines[this.gitignoreLines.length - 1] === "") {
      this.gitignoreLines.pop();
    }
    this.gitignoreLines.push(entry2.trim());
    await this.app.vault.adapter.write(".gitignore", this.gitignoreLines.join("\n") + "\n");
    new import_obsidian15.Notice(`Added to .gitignore: ${entry2.trim()}`);
  }
  async gitignoreRemove(entry2) {
    await this.loadGitignore();
    const before = this.gitignoreLines.length;
    this.gitignoreLines = this.gitignoreLines.filter((l) => l.trim() !== entry2.trim());
    if (this.gitignoreLines.length === before) return;
    await this.app.vault.adapter.write(".gitignore", this.gitignoreLines.join("\n") + "\n");
    new import_obsidian15.Notice(`Removed from .gitignore: ${entry2.trim()}`);
  }
  isSparseExcluded(path) {
    return this.deviceSettings.derivedProtectedPaths.includes(path);
  }
  lastKnownSparse() {
    return this.lastStatus?.sparse ?? null;
  }
  currentExcludeLines() {
    return [...this.excludeLines];
  }
  async cmdReapplySparse() {
    new ConfirmModal(
      this.app,
      {
        title: "Reapply sparse checkout?",
        body: [
          "This runs 'git sparse-checkout reapply' in Termux to re-hide paths excluded by your sparse rules.",
          "It does not delete data from the repository; it only updates which files are materialized in the working tree."
        ],
        confirmLabel: "Reapply sparse checkout"
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("sparse-reapply");
        if (!result) return;
        if (result.ok) {
          this.reportSuccess(
            "Sparse checkout reapplied",
            [
              "Sparse checkout rules were reapplied.",
              `Patterns now active: ${(result.data?.sparseList ?? "").split("\n").filter(Boolean).length}`
            ],
            result.data?.reapplyOutput
          );
        } else {
          new ResultModal(
            this.app,
            "Sparse reapply failed",
            [result.error?.message ?? "Unknown error."],
            { stdout: result.error?.stdout, stderr: result.error?.stderr, isError: true }
          ).open();
        }
      }
    ).open();
  }
  // ---------------------------------------------------- phase 3 git commands
  /**
   * True when Obsidian is currently drawing a dark theme. `theme-dark` on the
   * body is how Obsidian itself marks it; absent means light.
   */
  isDarkTheme() {
    try {
      return activeDocument.body.classList.contains("theme-dark");
    } catch {
      return true;
    }
  }
  /** The colour set in force, or null while custom colours are switched off. */
  activeColorSet() {
    if (!this.sharedPrefs.customColors) return null;
    return this.isDarkTheme() ? this.sharedPrefs.colorsDark : this.sharedPrefs.colorsLight;
  }
  diffColorVars() {
    const set = this.activeColorSet();
    return set ? diffColorVars(set) : null;
  }
  conflictColorVars() {
    const set = this.activeColorSet();
    return set ? conflictColorVars(set) : null;
  }
  /** Re-apply display preferences (and colours) to every open diff/conflict pane. */
  refreshDiffPanes() {
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_DIFF_VIEW)) {
      const view = leaf.view;
      if (view instanceof DiffView) view.refreshDisplay();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_FILE_HISTORY_VIEW)) {
      const view = leaf.view;
      if (view instanceof FileHistoryView) view.rerender();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_CONFLICT_VIEW)) {
      const view = leaf.view;
      if (view instanceof ConflictView) void view.reload();
    }
  }
  /** Merge and persist shareable UI preferences (data.json; cosmetic only). */
  async setSharedPref(patch) {
    this.sharedPrefs = { ...this.sharedPrefs, ...patch };
    await this.saveData(this.sharedPrefs);
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_DIFF_VIEW)) {
      const view = leaf.view;
      if (view instanceof DiffView) view.refreshDisplay();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_FILE_HISTORY_VIEW)) {
      const view = leaf.view;
      if (view instanceof FileHistoryView) view.rerender();
    }
    this.pushStatusToView();
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_HISTORY_VIEW)) {
      const view = leaf.view;
      if (view instanceof HistoryView) view.rerender();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_CONFLICT_VIEW)) {
      const view = leaf.view;
      if (view instanceof ConflictView) void view.reload();
    }
  }
  /** Parse the status fields every mutating action returns and refresh UI. */
  absorbStatusData(d) {
    if (typeof d.remoteUrl === "string") this.lastRemoteUrl = d.remoteUrl;
    if (!d.branchInfo) return;
    const status = parseStatusPorcelainV2(d.branchInfo);
    if (d.untrackedChildren !== void 0)
      status.untrackedChildren = groupUntrackedChildren(d.untrackedChildren, status.untracked);
    const sparse = parseSparseState({
      sparseEnabled: d.sparseEnabled ?? "",
      sparseCone: d.sparseCone ?? "",
      sparseList: d.sparseList ?? "",
      skipWorktreeCount: d.skipWorktreeCount,
      lsFilesV: d.lsFilesV
    });
    this.absorbSparsePatterns(sparse);
    this.lastStatus = {
      status,
      sparse,
      lastCommit: parseLastCommit(d.lastCommit ?? ""),
      fetchedAt: (/* @__PURE__ */ new Date()).toLocaleString(),
      mergeInProgress: d.mergeInProgress === "true",
      mergeMsg: d.mergeMsg?.trim() ? d.mergeMsg : void 0
    };
    this.applyStatusToStatusBar(status);
    this.pushStatusToView();
  }
  /**
   * Refresh the DERIVED protected paths from the repository's own sparse
   * exclusions, so the safety gate follows the repo configuration instead of
   * a hardcoded list. Persisted device-locally: protection must hold from the
   * very first operation after a restart, before any fresh status arrives.
   */
  absorbSparsePatterns(sparse) {
    if (!sparse.enabled) return;
    const candidates = sparseExclusionPaths(sparse.patterns);
    const validated = validateProtectedPaths(candidates);
    const derived = validated.ok ? validated.normalized : [];
    const prev = this.deviceSettings.derivedProtectedPaths;
    if (derived.length === prev.length && derived.every((p, i) => p === prev[i])) return;
    this.deviceSettings = this.store.write({ derivedProtectedPaths: derived });
    this.log.add(
      "info",
      "sparse",
      `Derived protected paths refreshed from sparse exclusions: ${derived.join(", ") || "(none)"}.`
    );
  }
  /**
   * The protected set actually enforced: manual paths plus (unless disabled)
   * the exclusions git itself reports. Every operation argument goes through
   * here — never through deviceSettings.protectedPaths directly.
   */
  effectiveProtectedPaths() {
    const s = this.deviceSettings;
    const merged = [...s.protectedPaths];
    if (s.autoProtectSparse) {
      for (const p of s.derivedProtectedPaths) if (!merged.includes(p)) merged.push(p);
    }
    return merged;
  }
  /** Shared error rendering for mutating operations. Never a bare "failed". */
  renderMutationError(title, result) {
    const err = result.error;
    const d = result.data ?? {};
    if (d.branchInfo) this.absorbStatusData(d);
    if (err?.code === "SAFETY_BLOCKED") {
      const report = evaluateSparseSafety(
        d.statusProtected ?? err.stdout ?? "",
        d.stagedProtected ?? err.stderr ?? "",
        this.effectiveProtectedPaths()
      );
      this.statusBar?.set("error");
      new SparseSafetyModal(this.app, report, SPARSE_SAFETY_WARNING, this.sparseSafetyFixes()).open();
      return;
    }
    if (err?.code === "CONFLICT") {
      const conflicts = (d.conflicts ?? "").split("\n").map((l) => l.trim()).filter((l) => l !== "");
      this.statusBar?.set("conflict", `(${conflicts.length})`);
      new ConflictModal(this.app, conflicts, {
        openFile: (path) => this.openVaultFile(path),
        abortMerge: () => this.cmdAbortMerge()
      }).open();
      return;
    }
    this.statusBar?.set("error");
    new ResultModal(this.app, title, [err?.message ?? "Unknown error."], {
      stdout: err?.stdout,
      stderr: err?.stderr,
      isError: true
    }).open();
  }
  openVaultFile(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof import_obsidian16.TFile) void this.app.workspace.getLeaf(false).openFile(f);
    else new import_obsidian15.Notice(`Cannot open ${path} (not found in vault).`);
  }
  async cmdFetch() {
    const result = await this.runOperation("fetch");
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: fetch failed", result);
    this.absorbStatusData(result.data ?? {});
    const st = this.lastStatus?.status;
    this.notify(`Fetched. Ahead ${st?.ahead ?? "?"}, behind ${st?.behind ?? "?"}.`);
  }
  async cmdPull(silent = false) {
    const result = await this.runOperation("pull", {
      protectedPaths: this.effectiveProtectedPaths()
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: pull failed", result);
    this.absorbStatusData(result.data ?? {});
    if (!silent) {
      this.reportSuccess("Native Git: pull", ["Pull completed."], result.data?.pullOutput);
    }
  }
  async cmdCommit() {
    const mergeMsg = this.lastStatus?.mergeInProgress ? this.lastStatus.mergeMsg : void 0;
    new CommitMessageModal(
      this.app,
      {
        title: mergeMsg ? "Commit merge" : "Commit changes",
        placeholder: "Commit message\u2026",
        submitLabel: "Commit",
        initial: mergeMsg
      },
      async (message) => {
        if (message === null) return;
        const result = await this.runOperation("commit", {
          protectedPaths: this.effectiveProtectedPaths(),
          message
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: commit failed", result);
        this.absorbStatusData(result.data ?? {});
        const committed = result.data?.committed === "true";
        this.reportSuccess(
          "Native Git: commit",
          [
            committed ? `Committed ${result.data?.newHead?.slice(0, 8) ?? ""}.` : "Nothing to commit (no staged changes after safety filtering)."
          ],
          result.data?.commitOutput
        );
      }
    ).open();
  }
  async cmdPush() {
    const result = await this.runOperation("push", {
      protectedPaths: this.effectiveProtectedPaths()
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: push failed", result);
    this.absorbStatusData(result.data ?? {});
    this.reportSuccess("Native Git: push", ["Push completed."], result.data?.pushOutput);
  }
  async cmdSync(message, silent = false) {
    const mergeMsg = this.lastStatus?.mergeInProgress ? this.lastStatus.mergeMsg : void 0;
    const result = await this.runOperation("sync", {
      protectedPaths: this.effectiveProtectedPaths(),
      message: message ?? mergeMsg ?? ""
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: sync failed", result);
    this.absorbStatusData(result.data ?? {});
    this.store.setValue(LAST_SYNC_KEY, (/* @__PURE__ */ new Date()).toLocaleString());
    const lines = [
      `Steps: ${(result.data?.steps ?? "").split(",").join(" \u2192 ")}`,
      `Committed: ${result.data?.committed ?? "false"} \xB7 Pushed: ${result.data?.pushed ?? "false"}`
    ];
    this.log.add("info", "sync", "Sync completed successfully.");
    if (silent) this.notify("Native Git: sync completed.");
    else this.reportSuccess("Native Git: sync completed", lines, result.data?.pullOutput);
  }
  async cmdAbortMerge() {
    new ConfirmModal(
      this.app,
      {
        title: "Abort merge?",
        body: [
          "This runs 'git merge --abort' and returns the repository to its state before the pull.",
          "Conflict resolutions you already made in the affected files will be discarded."
        ],
        confirmLabel: "Abort merge",
        danger: true
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("abort-merge");
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: abort merge failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify("Merge aborted; repository restored.");
      }
    ).open();
  }
  // ---------------------------------------------------- phase 4: history/diff
  activeFilePath() {
    const f = this.app.workspace.getActiveFile();
    if (!f) {
      new import_obsidian15.Notice("No active file.");
      return null;
    }
    return f.path;
  }
  /**
   * History / view-at-commit / restore for the active file. All three commands
   * open the same PANEL the context menu and the status panel open: one file
   * history surface, with the diff, the whole-file restore, the per-block
   * restore and the display preferences that every other diff has. The modal
   * this used to open rendered its own, plainer diff and was the last place in
   * the plugin where the same question got a different-looking answer.
   */
  cmdFileHistory() {
    const path = this.activeFilePath();
    if (path === null) return;
    void this.openFileHistoryPanel(path);
  }
  async showFileAtCommit(e) {
    const result = await this.runOperation("show-file-at-commit", {
      path: e.pathAtCommit,
      commit: e.hash
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: show file failed", result);
    const bytes = decodeBase64ToBytes(result.data?.contentBase64 ?? "");
    const text = bytesToTextIfNotBinary(bytes);
    const meta = `${e.pathAtCommit} @ ${e.hash.slice(0, 8)} \xB7 ${e.date.slice(0, 16).replace("T", " ")} \xB7 ${bytes.length} bytes`;
    if (text === null) {
      new ResultModal(this.app, "Binary file", [
        `${e.pathAtCommit} at ${e.hash.slice(0, 8)} is binary (${bytes.length} bytes); preview is not available.`,
        "Restore is still possible from the history list."
      ]).open();
      return;
    }
    new TextPreviewModal(this.app, "File at commit", meta, text).open();
  }
  async cmdDiffCurrentFile() {
    const path = this.activeFilePath();
    if (path === null) return;
    await this.openDiffPane({ path, from: "HEAD", to: "WORKTREE", label: "HEAD \u2192 working tree" });
  }
  confirmRestore(currentPath, e) {
    const renamed = e.pathAtCommit !== currentPath;
    new ConfirmModal(
      this.app,
      {
        title: "Restore file version?",
        body: [
          `File: ${e.pathAtCommit}`,
          `Version: ${e.hash.slice(0, 8)} (${e.date.slice(0, 16).replace("T", " ")}) \u2014 ${e.subject}`,
          renamed ? `Note: the file had a different name at that commit. The historical content will be written into the CURRENT file (${currentPath}); nothing is created at the old path.` : "The current working-tree content of this file will be overwritten. The version stays in Git history, but uncommitted edits to this file are lost."
        ],
        confirmLabel: "Restore this version",
        danger: true
      },
      async (confirmed) => {
        if (!confirmed) return;
        if (renamed) {
          const result2 = await this.runOperation("show-file-at-commit", {
            path: e.pathAtCommit,
            commit: e.hash
          });
          if (!result2) return;
          if (!result2.ok) return this.renderMutationError("Native Git: restore failed", result2);
          const bytes = decodeBase64ToBytes(result2.data?.contentBase64 ?? "");
          await this.app.vault.adapter.writeBinary(
            currentPath,
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
          );
          this.log.add("info", "restore-file", `Restored ${currentPath} from ${e.hash} (historical name ${e.pathAtCommit}).`);
          this.notify("File content restored from the selected version.");
          return;
        }
        const result = await this.runOperation("restore-file", {
          path: currentPath,
          commit: e.hash,
          protectedPaths: this.effectiveProtectedPaths()
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: restore failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify(`Restored ${currentPath} from ${e.hash.slice(0, 8)}.`);
      }
    ).open();
  }
  // ------------------------------------------------- status panel & selfcheck
  async openStatusPanel(reveal = true) {
    const existing = this.app.workspace.getLeavesOfType(NGB_STATUS_VIEW);
    if (existing.length > 0) {
      if (reveal) this.app.workspace.revealLeaf(existing[0]);
      this.pushStatusToView();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: NGB_STATUS_VIEW, active: reveal });
    if (reveal) this.app.workspace.revealLeaf(leaf);
    this.pushStatusToView();
  }
  // ------------------------------------------------- repository history & diff panes
  /** Open (or reveal and refresh) the repository-wide history panel. */
  async openHistoryPanel() {
    const existing = this.app.workspace.getLeavesOfType(NGB_HISTORY_VIEW);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      const view = existing[0].view;
      if (view instanceof HistoryView) await view.refresh();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: NGB_HISTORY_VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  /** Open (or retarget) the history panel of ONE file. */
  async openFileHistoryPanel(path) {
    const existing = this.app.workspace.getLeavesOfType(NGB_FILE_HISTORY_VIEW);
    const leaf = existing.length > 0 ? existing[0] : this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: NGB_FILE_HISTORY_VIEW, active: true, state: { path } });
    this.app.workspace.revealLeaf(leaf);
  }
  async loadFileLogPage(path, skip, limit) {
    const result = await this.runOperation("file-log", { path, skip, limit });
    if (!result) return null;
    if (!result.ok) {
      this.renderMutationError("Native Git: history failed", result);
      return null;
    }
    return parseFileLog(result.data?.log ?? "", path);
  }
  async loadRepoLogPage(skip, limit) {
    const result = await this.runOperation("repo-log", { skip, limit });
    if (!result) return null;
    if (!result.ok) {
      this.renderMutationError("Native Git: history failed", result);
      return null;
    }
    return parseRepoLog(result.data?.log ?? "");
  }
  /** The diff a commit introduced for one file, in an Obsidian pane. */
  async openCommitDiff(file, entry2) {
    const short = entry2.hash.slice(0, 8);
    await this.openDiffPane({
      path: file.path,
      from: `${entry2.hash}^`,
      to: entry2.hash,
      label: `${short}^ \u2192 ${short}`
    });
  }
  /**
   * Tap on a changed file in the status panel. A STAGED row shows what would
   * be committed (HEAD → index); an unstaged row shows what is NOT staged yet
   * (index → worktree) — so a file staged and then edited again shows two
   * genuinely different diffs.
   */
  async openStatusDiff(path, group) {
    if (group === "staged") {
      await this.openDiffPane({ path, from: "HEAD", to: "INDEX", label: "HEAD \u2192 staged" });
      return;
    }
    await this.openDiffPane({ path, from: "INDEX", to: "WORKTREE", label: "staged \u2192 working tree" });
  }
  async openDiffPane(state) {
    const existing = this.app.workspace.getLeavesOfType(NGB_DIFF_VIEW);
    const leaf = existing.length > 0 ? existing[0] : this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: NGB_DIFF_VIEW,
      active: true,
      state
    });
    this.app.workspace.revealLeaf(leaf);
  }
  // ------------------------------------------------- conflict resolution
  /** Vault file as text, or null when it looks binary (NUL byte probe). */
  async readVaultTextFile(path) {
    try {
      const buf = await this.app.vault.adapter.readBinary(path);
      return bytesToTextIfNotBinary(new Uint8Array(buf));
    } catch {
      return null;
    }
  }
  /**
   * Tap on a conflicted file: text files get the per-block resolution pane;
   * anything else gets the Git context menu (keep ours / keep theirs / open
   * in the default app) anchored where the user tapped.
   */
  async openConflict(path, pos) {
    const text = await this.readVaultTextFile(path);
    if (text !== null) {
      const existing = this.app.workspace.getLeavesOfType(NGB_CONFLICT_VIEW);
      const leaf = existing.length > 0 ? existing[0] : this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: NGB_CONFLICT_VIEW, active: true, state: { path } });
      this.app.workspace.revealLeaf(leaf);
      return;
    }
    const menu = new import_obsidian15.Menu();
    this.buildGitMenu(menu, path);
    menu.showAtPosition(pos);
  }
  /** Whole-file resolution via the runner, after explicit confirmation. */
  cmdResolveConflict(path, side) {
    new ConfirmModal(
      this.app,
      {
        title: side === "ours" ? "Keep the LOCAL version (yours)?" : "Keep the REMOTE version?",
        body: [
          `File: ${path}`,
          side === "ours" ? "The incoming remote changes to this file are discarded; your local version is kept and the file is marked resolved." : "Your local changes to this file are discarded; the incoming remote version is kept and the file is marked resolved.",
          "This cannot be undone for the losing side's uncommitted content."
        ],
        confirmLabel: side === "ours" ? "Keep local" : "Keep remote",
        danger: true
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("resolve-conflict", {
          path,
          side,
          protectedPaths: this.effectiveProtectedPaths()
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: resolve failed", result);
        this.absorbStatusData(result.data ?? {});
        for (const leaf of this.app.workspace.getLeavesOfType(NGB_CONFLICT_VIEW)) {
          const view = leaf.view;
          if (view instanceof ConflictView && view.filePath === path) leaf.detach();
        }
        this.notify(`Resolved ${path} (kept the ${side === "ours" ? "local" : "remote"} version).`);
      }
    ).open();
  }
  /**
   * Open a file with the system's default app. `openWithDefaultApp` is not in
   * the public typings on mobile, so this degrades to a notice when absent
   * (documented in docs/submission.md alongside the other private-API uses).
   */
  openWithDefaultApp(path) {
    const anyApp = this.app;
    if (typeof anyApp.openWithDefaultApp === "function") anyApp.openWithDefaultApp(path);
    else new import_obsidian15.Notice("Opening with the default app is not available in this Obsidian version.");
  }
  /**
   * Unified diff text for the diff pane. A root commit has no parent: when
   * "<hash>^" fails, the diff is retried against git's canonical empty tree,
   * so the first commit renders as all-additions instead of an error.
   */
  async loadDiffText(path, from, to) {
    let result = await this.runOperation("diff-file", { path, from, to });
    if (result && !result.ok && from.endsWith("^")) {
      result = await this.runOperation("diff-file", { path, from: EMPTY_TREE_HASH, to });
    }
    if (!result) return null;
    if (!result.ok) {
      this.renderMutationError("Native Git: diff failed", result);
      return null;
    }
    return { diff: result.data?.diff ?? "", truncated: result.data?.truncated === "true" };
  }
  /** Tick the elapsed-time label without rebuilding the panel. */
  updateProgressInView(text) {
    for (const leaf of this.app.workspace.getLeavesOfType(NGB_STATUS_VIEW)) {
      const view = leaf.view;
      if (view instanceof StatusView) view.updateProgressText(text);
    }
  }
  /** Mirror current state into the sidebar panel (works on mobile). */
  pushStatusToView() {
    const leaves = this.app.workspace.getLeavesOfType(NGB_STATUS_VIEW);
    if (leaves.length === 0) return;
    const state = this.statusBar?.current ?? (this.lock.active ? "syncing" : "clean");
    const extra = {
      sparse: this.lastStatus?.sparse,
      activeOperation: this.lock.active ? this.lock.active.action : void 0,
      progress: this.progressText ?? void 0,
      runningAction: this.runningAction ?? void 0,
      runningPath: this.runningPath ?? void 0,
      treeView: this.sharedPrefs.treeView,
      lastSyncAt: this.store.getValue(LAST_SYNC_KEY) ?? void 0,
      fetchedAt: this.lastStatus?.fetchedAt,
      bridge: this.deviceSettings.termuxIntegrationEnabled ? "companion app" : "disabled"
    };
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof StatusView) {
        if (this.lastStatus) view.setData(summaryToViewData(this.lastStatus.status, extra, state));
        else
          view.setData({
            state,
            ahead: 0,
            behind: 0,
            staged: [],
            unstaged: [],
            untracked: [],
            conflicted: [],
            ...extra
          });
      }
    }
  }
  /** Local bridge diagnosis that works even when nothing comes back from Termux. */
  /**
   * The setup guide: three parts in order, each with a one-tap action. Shown
   * whenever an operation is attempted before the bridge is usable — on a
   * fresh install that is the FIRST thing the user sees, so it must name the
   * companion app and Termux, not just the missing token.
   */
  openSetupGuide(reason) {
    const s = this.deviceSettings;
    if (!import_obsidian15.Platform.isAndroidApp) {
      new import_obsidian15.Notice("Native Git Bridge works on Android only (it delegates git to Termux).");
      return;
    }
    const lines = [
      reason,
      "",
      "Three parts are needed, in this order:",
      "1. Termux (runs the real git) \u2014 the F-Droid build.",
      "2. Git Bridge Companion app (the only way Obsidian can trigger Termux).",
      "3. One command pasted into Termux \u2014 it installs the runner and pairs this plugin automatically (no token typing).",
      "",
      `Termux: ${TERMUX_SITE_URL} (direct: ${TERMUX_FDROID_URL})`,
      `Companion APK: ${COMPANION_RELEASES_URL}`,
      "",
      "Current state on this device:",
      `Enabled here: ${s.enabledOnThisDevice ? "yes" : "NO (turn it on in settings)"}`,
      `Termux integration: ${s.termuxIntegrationEnabled ? "on" : "OFF (turn it on in settings)"}`,
      `Paired with a runner: ${s.authToken ? "yes" : "NO (step 3 pairs it automatically)"}`,
      `Profile for this vault: ${s.profileId || "none yet"}`,
      `Companion seen so far: ${this.lastCompanionAckMs > 0 ? "yes" : "not yet"}`,
      `Termux installed: ${this.lastAckTermuxInstalled === null ? "unknown (the companion reports this)" : this.lastAckTermuxInstalled ? "yes" : "NO"}`
    ];
    const actions = [
      {
        label: "Get Termux",
        keepOpen: true,
        onClick: () => this.openUrlPreferCompanion(COMPANION_GET_TERMUX_URI, TERMUX_SITE_URL)
      },
      {
        label: "Copy release link",
        keepOpen: true,
        onClick: () => {
          void navigator.clipboard.writeText(COMPANION_RELEASES_URL);
          new import_obsidian15.Notice("Release link copied - open it in Chrome or Firefox and download the APK there.");
        }
      },
      {
        label: "Open companion setup",
        keepOpen: true,
        onClick: () => void this.openCompanionSetup()
      },
      {
        label: "Copy command & open Termux",
        cta: true,
        keepOpen: true,
        onClick: () => this.copyCommandAndOpenTermux()
      }
    ];
    if (this.installCommandLocal() !== null) {
      actions.push({
        label: "Copy offline command",
        keepOpen: true,
        onClick: () => this.copyLocalCommandAndOpenTermux()
      });
    }
    if (!s.authToken) {
      actions.splice(actions.length - 1, 0, {
        label: "Pair this vault",
        keepOpen: true,
        onClick: () => void this.cmdPairThisVault()
      });
    } else {
      actions.splice(actions.length - 1, 0, {
        label: "Set up repository",
        keepOpen: true,
        onClick: () => void this.cmdSetupRepository()
      });
    }
    if (!s.enabledOnThisDevice || !s.termuxIntegrationEnabled) {
      actions.unshift({
        label: "Enable on this device",
        keepOpen: true,
        onClick: () => {
          void this.updateDeviceSettings({ enabledOnThisDevice: true, termuxIntegrationEnabled: true }).then(
            () => new import_obsidian15.Notice("Enabled. Now do steps 1-3 if you have not yet.")
          );
        }
      });
    }
    this.log.add("info", "setup", `Setup guide shown: ${reason}`);
    new ResultModal(this.app, "Set up Native Git Bridge", lines, { actions }).open();
  }
  /**
   * Version advice for the three independently updated parts. Until Obsidian
   * itself offers the update (this plugin is not in the community catalogue
   * yet), a mismatch can only be reported — never auto-fixed.
   */
  /**
   * True only when the companion actually reported a version older than this
   * plugin. "It answered at all" is not evidence of being outdated, and the
   * bridge check used to offer an update on that basis alone, which on a
   * matched pair reads like something is wrong when nothing is.
   */
  companionOutdated() {
    const companion = this.lastCompanionVersion;
    if (companion === "") return false;
    return compareVersions(this.manifest.version, companion) > 0;
  }
  versionAdvice() {
    const out = [];
    const plugin = this.manifest.version;
    const companion = this.lastCompanionVersion;
    if (companion !== "") {
      const cmp = compareVersions(plugin, companion);
      if (cmp < 0) {
        out.push({
          part: "plugin",
          text: `The plugin (${plugin}) is OLDER than the companion app (${companion}). Update the plugin: download main.js, manifest.json and styles.css from the latest release into .obsidian/plugins/native-git-bridge/, then reload the plugin.`
        });
      } else if (cmp > 0) {
        out.push({
          part: "companion",
          text: `The companion app (${companion}) is OLDER than the plugin (${plugin}). Install the newest APK from the latest release (it updates over the current one).`
        });
      }
    }
    if (this.lastRunnerVersion > 0 && this.lastRunnerVersion !== RUNNER_MIN_VERSION) {
      out.push({
        part: "runner",
        text: this.lastRunnerVersion < RUNNER_MIN_VERSION ? `The Termux runner (v${this.lastRunnerVersion}) is older than this plugin needs (v${RUNNER_MIN_VERSION}). Re-run the install command in Termux \u2014 updating the plugin never updates the runner.` : `The Termux runner (v${this.lastRunnerVersion}) is NEWER than this plugin expects (v${RUNNER_MIN_VERSION}). Update the plugin from the latest release.`
      });
    }
    return out;
  }
  /** The one-line Termux install command (same one settings shows). */
  installCommand() {
    return bootstrapCommand(this.manifest.version, this.deviceSettings.repoPathHint);
  }
  /**
   * The same install taken from the copy inside this vault instead of from a
   * release. Only meaningful once the repository path is known, because Termux
   * addresses the vault by its own absolute path.
   */
  installCommandLocal() {
    const p = this.deviceSettings.repoPathHint.trim().replace(/\/+$/, "");
    if (p === "" || !p.startsWith("/")) return null;
    return bootstrapCommandLocal(p, this.app.vault.configDir);
  }
  /** Copy the offline install command, then bring Termux to the front. */
  copyLocalCommandAndOpenTermux() {
    const cmd = this.installCommandLocal();
    if (cmd === null) {
      new import_obsidian15.Notice("Set the repository path in settings first \u2014 Termux needs the vault's absolute path.");
      return;
    }
    void navigator.clipboard.writeText(cmd);
    new import_obsidian15.Notice("Offline install command copied - long-press in Termux to paste, then Enter.");
    this.openExternalUri(COMPANION_OPEN_TERMUX_URI);
  }
  /** Open the latest release page (companion APK + plugin files live there). */
  openLatestRelease() {
    this.openUrlPreferCompanion(COMPANION_DOWNLOAD_APK_URI, COMPANION_RELEASES_URL);
  }
  /** Copy the install command, then bring Termux to the front (via the companion). */
  copyCommandAndOpenTermux() {
    void navigator.clipboard.writeText(this.installCommand());
    new import_obsidian15.Notice("Install command copied - long-press in Termux to paste, then Enter.");
    this.openExternalUri(COMPANION_OPEN_TERMUX_URI);
  }
  async cmdSelfCheck(timedOut = false) {
    registerIcons();
    const paths = new RuntimePaths(this.app.vault.configDir);
    const report = await runSelfCheck(this.makeRuntimeFS(), paths, timedOut, this.deviceSettings.profileId);
    const outdated = /ERROR building result for [^(]*$/m.test(report.runnerLogTail);
    const lines = [report.verdict];
    if (outdated) {
      lines.push("", "The Termux runner is OUTDATED. Fix: the button below copies the install command and opens Termux - paste and run it there.");
    }
    lines.push(
      "",
      `Runtime folder (as the plugin sees it): ${paths.root}`,
      `Profile for this vault: ${report.profileId || "none yet"}${report.markerProfileId && report.markerProfileId !== report.profileId ? ` (the runner wrote ${report.markerProfileId} here)` : ""}`,
      `Runner has written into THIS vault's runtime folder: ${report.runnerLogExists ? "yes" : "NO"}`,
      `Queued requests: ${report.queuedRequests.length}${report.queuedRequests.length ? " (" + report.queuedRequests.join(", ") + ")" : ""}`,
      `Pairing file waiting: ${report.pairingFilePresent ? "yes" : "no"}`
    );
    for (const a of this.versionAdvice()) lines.push("", a.text);
    this.log.add(report.ok ? "info" : "warn", "self-check", report.verdict);
    const actions = [];
    if (import_obsidian15.Platform.isAndroidApp) {
      actions.push({
        label: "Copy command & open Termux",
        cta: true,
        onClick: () => this.copyCommandAndOpenTermux()
      });
      if (this.lastAckTermuxInstalled !== false) {
        actions.push({
          label: "Open Termux",
          keepOpen: true,
          onClick: () => this.openExternalUri(COMPANION_OPEN_TERMUX_URI)
        });
      }
      if (this.lastAckTermuxInstalled === false) {
        actions.push({
          label: "Get Termux",
          keepOpen: true,
          onClick: () => this.openUrlPreferCompanion(COMPANION_GET_TERMUX_URI, TERMUX_SITE_URL)
        });
        lines.push(
          "",
          `Termux is NOT installed on this device. Official site: ${TERMUX_SITE_URL}`,
          `Direct F-Droid page: ${TERMUX_FDROID_URL} \u2014 do not use the Play Store build, it is deprecated.`
        );
      }
      if (this.lastCompanionAckMs === 0) {
        actions.push({
          label: "Copy release link",
          keepOpen: true,
          onClick: () => {
            void navigator.clipboard.writeText(COMPANION_RELEASES_URL);
            new import_obsidian15.Notice("Release link copied - open it in Chrome or Firefox and download the APK there.");
          }
        });
      } else if (this.companionOutdated()) {
        actions.push({
          label: "Update companion app",
          keepOpen: true,
          onClick: () => this.openExternalUri(COMPANION_DOWNLOAD_APK_URI)
        });
      }
    }
    new ResultModal(this.app, "Bridge check", lines, {
      stdout: report.runnerLogTail || void 0,
      isError: !report.ok,
      actions
    }).open();
  }
  // ------------------------------------------------- per-file staging actions
  async cmdStageAll() {
    const result = await this.runOperation("stage-all", {
      protectedPaths: this.effectiveProtectedPaths()
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: stage all failed", result);
    this.absorbStatusData(result.data ?? {});
    this.notify("Staged all permitted changes (protected paths excluded).");
  }
  async cmdUnstageAll() {
    const result = await this.runOperation("unstage-all", {
      protectedPaths: this.effectiveProtectedPaths()
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: unstage all failed", result);
    this.absorbStatusData(result.data ?? {});
    this.notify("Unstaged all changes.");
  }
  async cmdStageFile(path, mode = "all") {
    const result = await this.runOperation("stage-file", {
      path,
      mode,
      protectedPaths: this.effectiveProtectedPaths()
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: stage failed", result);
    this.absorbStatusData(result.data ?? {});
  }
  /**
   * Tree-layout folder actions, scoped to the GROUP the folder row lives in:
   * stage in "Changes" stages tracked changes only (`git add -u`), stage in
   * "Untracked" stages the new files (`git add`), unstage touches only what
   * was staged (`git restore --staged`), discard in "Untracked" moves the new
   * files to Obsidian's trash (reversible), elsewhere it is the confirmed
   * git discard. One request per folder — never one per file.
   */
  folderAction(group, folderPath, kind) {
    if (kind === "stage") {
      void this.cmdStageFile(folderPath, group === "unstaged" ? "update" : "all");
      return;
    }
    if (kind === "unstage") {
      void this.cmdUnstageFile(folderPath);
      return;
    }
    if (group === "untracked") {
      this.confirmTrashUntrackedFolder(folderPath);
      return;
    }
    this.cmdDiscardFile(folderPath);
  }
  /**
   * Group-header buttons. "Stage" in the tracked-changes group must not sweep
   * in untracked files, so it stages the repository root in `update` mode; the
   * untracked group uses a plain add. Discard maps to the repository-wide
   * discard command, which keeps staged content and untracked files.
   */
  groupAction(group, kind) {
    if (kind === "unstage") {
      void this.cmdUnstageAll();
      return;
    }
    if (kind === "discard") {
      this.cmdDiscardAll();
      return;
    }
    if (group === "unstaged") void this.cmdStageFile(".", "update");
    else void this.cmdStageAll();
  }
  /**
   * The group's own context menu: the bulk versions of the per-file entries,
   * gated by the same three settings toggles. Every bulk entry states how many
   * paths it will touch before doing anything.
   */
  buildGroupMenu(menu, group) {
    if (!import_obsidian15.Platform.isAndroidApp) return;
    if (!this.deviceSettings.enabledOnThisDevice) return;
    this.addMenuEntries(menu, { kind: "group", group, count: this.groupPaths(group).length });
  }
  /** Paths currently listed in a panel group (as the panel last saw them). */
  groupPaths(group) {
    const st = this.lastStatus?.status;
    if (!st) return [];
    const raw = group === "staged" ? st.staged.map((e) => e.path) : group === "unstaged" ? st.unstaged.map((e) => e.path) : group === "conflicted" ? st.conflicted.map((e) => e.path) : st.untracked;
    return [...new Set(raw.map((p) => p.endsWith("/") ? p.slice(0, -1) : p))];
  }
  /** .gitignore is a tracked vault file, so a bulk add is ONE write. */
  confirmBulkIgnore(paths) {
    new ConfirmModal(
      this.app,
      {
        title: `Add ${paths.length} paths to .gitignore?`,
        body: [
          ...paths.slice(0, 10),
          paths.length > 10 ? `\u2026and ${paths.length - 10} more` : "",
          ".gitignore is a tracked file, so this change reaches every device and every collaborator once committed."
        ].filter((l) => l !== ""),
        confirmLabel: "Add to .gitignore",
        icon: "eye-off"
      },
      async (ok) => {
        if (!ok) return;
        for (const p of paths) await this.gitignoreAdd(`/${p}`);
        this.notify(`Added ${paths.length} paths to .gitignore.`);
      }
    ).open();
  }
  /**
   * Sparse exclusions and .git/info/exclude are runner actions, so a bulk
   * apply is one round trip per path. The count is stated up front because on
   * a large group this is slow, and every round trip wakes Termux.
   */
  confirmBulkPerPath(paths, kind) {
    const label2 = kind === "sparse" ? "sparse exclusions" : ".git/info/exclude";
    new ConfirmModal(
      this.app,
      {
        title: `Add ${paths.length} paths to ${label2}?`,
        body: [
          ...paths.slice(0, 10),
          paths.length > 10 ? `\u2026and ${paths.length - 10} more` : "",
          `This runs one Termux round trip per path (${paths.length} in total) and cannot be cancelled halfway without leaving part of the list applied.`,
          kind === "sparse" ? "Hidden paths are removed from THIS device's working tree and automatically join the protected set." : "The exclude file is device-local and never synced."
        ].filter((l) => l !== ""),
        confirmLabel: `Apply to ${paths.length} paths`,
        icon: "eye-off",
        danger: kind === "sparse"
      },
      async (ok) => {
        if (!ok) return;
        for (const p of paths) {
          if (kind === "sparse") await this.cmdSparseExclude(p, true, true);
          else await this.cmdExcludeChange(p, true);
        }
        this.notify(`Applied to ${paths.length} paths.`);
        await this.cmdStatus(true);
      }
    ).open();
  }
  /** Move every untracked entry under a folder to Obsidian's trash, confirmed. */
  confirmTrashUntrackedFolder(folderPath) {
    const st = this.lastStatus?.status;
    if (!st) return;
    const prefix = `${folderPath}/`;
    const targets = st.untracked.filter((u) => u.startsWith(prefix) || u === prefix);
    if (targets.length === 0) return;
    new ConfirmModal(
      this.app,
      {
        title: "Move new files to trash?",
        body: [
          `Folder: ${folderPath}`,
          `${targets.length} untracked entr${targets.length === 1 ? "y" : "ies"} will move to Obsidian's trash (.trash in the vault) \u2014 this is reversible from there.`
        ],
        confirmLabel: "Move to trash",
        danger: true
      },
      async (confirmed) => {
        if (!confirmed) return;
        for (const t of targets) {
          const p = t.endsWith("/") ? t.slice(0, -1) : t;
          try {
            await this.app.vault.adapter.trashLocal(p);
          } catch (e) {
            this.log.add("error", "discard-file", `Trash failed for ${p}: ${String(e)}`);
          }
        }
        this.notify(`Moved ${targets.length} untracked entr${targets.length === 1 ? "y" : "ies"} to the trash.`);
        await this.cmdStatus(true);
      }
    ).open();
  }
  async cmdUnstageFile(path) {
    const result = await this.runOperation("unstage-file", {
      path,
      protectedPaths: this.effectiveProtectedPaths()
    });
    if (!result) return;
    if (!result.ok) return this.renderMutationError("Native Git: unstage failed", result);
    this.absorbStatusData(result.data ?? {});
  }
  /**
   * Discard every unstaged change at once (the Changes group as a whole).
   * Staged work and untracked files survive: dropping those is `git clean`
   * territory and needs its own explicit action, not a side effect here.
   */
  cmdDiscardAll() {
    const st = this.lastStatus?.status;
    const n = st?.unstaged.length ?? 0;
    new ConfirmModal(
      this.app,
      {
        title: "Discard all local changes?",
        body: [
          n > 0 ? `${n} file${n === 1 ? "" : "s"} with unstaged changes will go back to the staged version (or to HEAD when nothing is staged for them).` : "All unstaged changes will go back to the staged version (or to HEAD).",
          "Staged changes and untracked files are kept. Protected sparse paths are excluded.",
          "This cannot be undone: the discarded edits are not in Git history."
        ],
        confirmLabel: "Discard local changes",
        icon: "undo-2",
        danger: true
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("discard-all", {
          protectedPaths: this.effectiveProtectedPaths()
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: discard failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify("Discarded all unstaged changes.");
      }
    ).open();
  }
  /**
   * The effect of `git reset --hard`, expressed as a pathspec restore so the
   * protected sparse paths can be excluded. HEAD is not moved and untracked
   * files are not deleted, both of which a literal --hard would do.
   */
  cmdResetAll() {
    const st = this.lastStatus?.status;
    const n = (st?.staged.length ?? 0) + (st?.unstaged.length ?? 0);
    new ConfirmModal(
      this.app,
      {
        title: "Reset everything to HEAD?",
        body: [
          n > 0 ? `${n} staged and unstaged change${n === 1 ? "" : "s"} will be thrown away; the working tree and the index go back to the last commit.` : "The working tree and the index go back to the last commit.",
          "Untracked files are kept, and protected sparse paths are excluded. The branch itself is not moved: commits are untouched.",
          "This cannot be undone: nothing being discarded here is in Git history."
        ],
        confirmLabel: "Reset to HEAD",
        icon: "rotate-ccw",
        danger: true
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("reset-all", {
          protectedPaths: this.effectiveProtectedPaths()
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: reset failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify("Reset the working tree and index to HEAD.");
      }
    ).open();
  }
  cmdDiscardFile(path) {
    new ConfirmModal(
      this.app,
      {
        title: "Discard changes?",
        body: [
          `File: ${path}`,
          "Tracked files are reset to the last commit; untracked files are deleted.",
          "This cannot be undone \u2014 the changes are not in Git history."
        ],
        confirmLabel: "Discard changes",
        danger: true
      },
      async (confirmed) => {
        if (!confirmed) return;
        const result = await this.runOperation("discard-file", {
          path,
          protectedPaths: this.effectiveProtectedPaths()
        });
        if (!result) return;
        if (!result.ok) return this.renderMutationError("Native Git: discard failed", result);
        this.absorbStatusData(result.data ?? {});
        this.notify(`Discarded changes in ${path}.`);
      }
    ).open();
  }
  async cmdDiagnostics() {
    const report = { pluginSide: {}, problems: [] };
    const s = this.deviceSettings;
    report.pluginSide["Plugin version"] = this.manifest.version;
    report.pluginSide["Platform"] = import_obsidian15.Platform.isAndroidApp ? "Android app" : import_obsidian15.Platform.isMobile ? "mobile" : "desktop";
    report.pluginSide["Enabled on this device"] = String(s.enabledOnThisDevice);
    report.pluginSide["Termux integration"] = String(s.termuxIntegrationEnabled);
    report.pluginSide["Pairing token set"] = s.authToken ? "yes" : "no";
    report.pluginSide["Profile for this vault"] = s.profileId || "(none yet)";
    report.pluginSide["Protected paths (manual)"] = s.protectedPaths.join(", ") || "(none)";
    report.pluginSide["Protected paths (derived from sparse)"] = (s.autoProtectSparse ? s.derivedProtectedPaths.join(", ") : "(auto-protect off)") || "(none)";
    report.pluginSide["Protected paths (effective)"] = this.effectiveProtectedPaths().join(", ") || "(none)";
    report.pluginSide["Device-local storage"] = this.store.isVolatile ? "VOLATILE (in-memory fallback)" : "persistent";
    report.pluginSide["Pending requests"] = String(await this.client.pendingRequestCount());
    report.pluginSide["Active operation"] = this.lock.active ? `${this.lock.active.action} (${this.lock.active.id})` : "none";
    if (!import_obsidian15.Platform.isAndroidApp)
      report.problems.push(
        "Not an Android device: the bridge (companion app + Termux) exists only on Android, so all operations are disabled here."
      );
    if (this.store.isVolatile) report.problems.push("Device-local storage is unavailable; settings will not persist.");
    if (!s.authToken) report.problems.push("No pairing token configured.");
    if (this.effectiveProtectedPaths().length === 0)
      report.problems.push(
        "No protected sparse paths (neither manual nor derived from sparse exclusions). Fine for full checkouts; risky if this repo uses sparse checkout."
      );
    if (import_obsidian15.Platform.isAndroidApp) {
      if (this.isObsidianGitActiveOnDevice()) {
        report.problems.push(
          "obsidian-git is ACTIVE on this device (not device-disabled): incompatible with a native sparse-checkout index. Use its 'Disable on this device' toggle."
        );
      }
    }
    if (s.enabledOnThisDevice && s.termuxIntegrationEnabled && s.authToken) {
      const result = await this.runOperation("diagnostics");
      if (result?.ok && result.data) {
        report.runnerSide = {};
        for (const [k, v] of Object.entries(result.data)) report.runnerSide[k] = v;
        const rv = Number(result.data.runnerVersion ?? result.runnerVersion ?? 1);
        if (!Number.isNaN(rv) && rv < RUNNER_MIN_VERSION) {
          report.problems.push(
            `Termux runner is version ${rv}, this plugin needs ${RUNNER_MIN_VERSION}. ${RUNNER_OUTDATED_HINT}`
          );
        }
        if (result.data.sparseEnabled?.trim() !== "true") {
          report.problems.push("core.sparseCheckout is not 'true' in the repository.");
        }
      } else if (result && !result.ok) {
        report.problems.push(`Runner diagnostics failed: ${result.error?.message ?? "unknown error"}`);
      }
    }
    new DiagnosticsModal(this.app, report).open();
  }
  async cmdCancel() {
    if (!this.activeCancel) {
      new import_obsidian15.Notice("No operation is currently awaiting a result.");
      return;
    }
    this.activeCancel.cancel();
  }
};
function compareVersions(a, b) {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10) || 0;
    const nb = Number.parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}
function getLocalStorageBackend() {
  try {
    const ls = typeof activeWindow !== "undefined" ? activeWindow.localStorage : void 0;
    if (!ls) return null;
    const probe = "__ngb_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}
