// vim:set tw=80 ts=4 sw=4 sts=4 sta et:
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Mozilla Skywriter.
 *
 * The Initial Developer of the Original Code is
 * Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Mihai Sucan <mihai.sucan@gmail.com> (original author)
 *   Kevin Dangoor (kdangoor@mozilla.com)
 *   Nick Fitzgerald <nfitzgerald@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

var fs = require("fs");
var path = require('path');
var ujs = require("uglify-js");


/**
 * See https://github.com/mozilla/dryice for usage instructions.
 */
function copy(obj) {
    // Gather a list of all the input sources
    addSource(obj, obj.source);

    // Concatenate all the input sources
    var value = '';
    obj.sources.forEach(function(source) {
        value += source.value;
    }, this);

    // Run filters where onRead=false
    value = runFilters(value, obj.filter, false);

    // Output
    // TODO: for now we're ignoring the concept of directory destinations.
    if (typeof obj.dest.value === 'string') {
        obj.dest.value += value;
    }
    else if (typeof obj.dest === 'string') {
        fs.writeFileSync(obj.dest, value);
    }
    else {
        throw new Error('Can\'t handle type of dest: ' + typeof obj.dest);
    }
}

function addName(currentName, newName) {
    return currentName === null ? currentName : newName;
}

function addSource(obj, source) {
    if (!obj.sources) {
        obj.sources = [];
    }

    if (typeof source === 'function') {
        addSource(obj, source());
    }
    else if (Array.isArray(source)) {
        source.forEach(function(s) {
            addSource(obj, s);
        }, this);
    }
    else if (source instanceof NullModule) {
        source.value = source.toString();
        source.filtered = true;
        obj.sources.push(source);
    }
    else if (source.root) {
        copy.findFiles(obj, source);
    }
    else if (source.base) {
        addSourceBase(obj, source);
    }
    else if (typeof source === 'string') {
        addSourceFile(obj, source);
    }
    else if (typeof source.value === 'string') {
        if (!source.filtered) {
            source.value = runFilters(source.value, obj.filter, true, source.name);
            source.filtered = true;
        }
        obj.sources.push(source);
    }
    else {
        throw new Error('Can\'t handle type of source: ' + typeof source);
    }
}

function addSourceFile(obj, filename) {
    var read = fs.readFileSync(filename);
    obj.sources.push({
        name: filename,
        value: runFilters(read, obj.filter, true, filename)
    });
}

function addSourceBase(obj, baseObj) {
    var read = fs.readFileSync(baseObj.base + baseObj.path);
    obj.sources.push({
        name: baseObj,
        value: runFilters(read, obj.filter, true, baseObj)
    });
}

function runFilters(value, filter, reading, name) {
    if (!filter) {
        return value;
    }

    if (Array.isArray(filter)) {
        filter.forEach(function(f) {
            value = runFilters(value, f, reading, name);
        }, this);
        return value;
    }

    if (!!filter.onRead == reading) {
        return filter(value, name);
    }
    else {
        return value;
    }
}

/**
 * A holder is an in-memory store of a result of a copy operation.
 * <pre>
 * var holder = copy.createDataObject();
 * copy({ source: 'x.txt', dest: holder });
 * copy({ source: 'y.txt', dest: holder });
 * copy({ source: holder, dest: 'z.txt' });
 * </pre>
 */
copy.createDataObject = function() {
    return { value: '' };
};

/**
 * An object that contains include and exclude object
 */
copy.findFiles = function(obj, findObj) {
    if (!findObj.filter) {
        findObj.filter = createFilterFromRegex(findObj);
    }

    if (findObj.root instanceof CommonJsProject) {
        findObj.root = findObj.root.roots;
    }
    if (Array.isArray(findObj.root)) {
        findObj.root.forEach(function(root) {
            copy.findFiles(obj, {
                root: ensureTrailingSlash(root),
                filter: findObj.filter
            });
        });
        return;
    }

    if (!findObj.path) {
        findObj.path = '';
    }

    var path = ensureTrailingSlash(findObj.path);
    var root = ensureTrailingSlash(findObj.root);

    if (isDirectory(root + path)) {
        fs.readdirSync(root + path).forEach(function(entry) {
            var stat = fs.statSync(root + path + entry);
            if (stat.isFile()) {
                if (findObj.filter(path + entry)) {
                    addSourceBase(obj, {
                        base: root,
                        path: path + entry
                    });
                }
            }
            else if (stat.isDirectory()) {
                copy.findFiles(obj, {
                    root: root,
                    path: path + entry,
                    filter: findObj.filter
                });
            }
        }, this);
    }
};

function createFilterFromRegex(obj) {
    return function(path) {
        function noPathMatch(pattern) {
            return !pattern.test(path);
        }
        if (obj.include instanceof RegExp) {
            if (noPathMatch(obj.include)) {
                return false;
            }
        }
        if (typeof obj.include === 'string') {
            if (noPathMatch(new RegExp(obj.include))) {
                return false;
            }
        }
        if (Array.isArray(obj.include)) {
            if (obj.include.every(noPathMatch)) {
                return false;
            }
        }

        function pathMatch(pattern) {
            return pattern.test(path);
        }
        if (obj.exclude instanceof RegExp) {
            if (pathMatch(obj.exclude)) {
                return false;
            }
        }
        if (typeof obj.exclude === 'string') {
            if (pathMatch(new RegExp(obj.exclude))) {
                return false;
            }
        }
        if (Array.isArray(obj.exclude)) {
            if (obj.exclude.some(pathMatch)) {
                return false;
            }
        }

        return true;
    };
}

/**
 * This represents a module which has been ignored, but must still be defined so
 * that things which require it do not throw errors.
 */
function NullModule(path) {
    this.path = path;
    this.deps = {};
}
NullModule.prototype.toString = function() {
    return 'define("' + this.path + '", [], void 0);\n';
};

/**
 * Keep track of the files in a project
 */
function CommonJsProject(opts) {
    this.roots = opts.roots;
    this.ignoreRequires = opts.ignores || [];

    this.currentFiles = {};
    this.ignoredFiles = {};
}

(function() {
    CommonJsProject.prototype.report = function() {
        var reply = 'CommonJS project at ' + this.roots.join(', ') + '\n';

        reply += '- Required modules:\n';
        var moduleNames = Object.keys(this.currentFiles);
        if (moduleNames.length > 0) {
            moduleNames.forEach(function(module) {
                var deps = Object.keys(this.currentFiles[module].deps).length;
                reply += '  - ' + module + ' (' + deps +
                    (deps === 1 ? ' dependency' : ' dependencies') + ')\n';
            }, this);
        }
        else {
            reply += '  - None\n';
        }

        reply += '- Ignored modules:\n';
        var ignoredNames = Object.keys(this.ignoredFiles);
        if (ignoredNames.length > 0) {
            ignoredNames.forEach(function(module) {
                var deps = this.ignoredFiles[module].deps.length;
                reply += '  - ' + module + '\n';
            }, this);
        }
        else {
            reply += '  - None\n';
        }

        reply += '- Ignored requires:\n';
        if (this.ignoreRequires.length > 0) {
            reply += '  - ' + this.ignoreRequires.join('\n  - ') + '\n';
        }
        else {
            reply += '  - None\n';
        }

        return reply;
    };

    CommonJsProject.prototype.assumeAllFilesLoaded = function() {
        Object.keys(this.currentFiles).forEach(function(module) {
            this.ignoredFiles[module] = this.currentFiles[module];
        }, this);
        this.currentFiles = {};
    };

    CommonJsProject.prototype.clone = function() {
        var clone = new CommonJsProject(this.roots);

        Object.keys(this.currentFiles).forEach(function(module) {
            clone.currentFiles[module] = this.currentFiles[module];
        }, this);

        Object.keys(this.ignoredFiles).forEach(function(module) {
            clone.ignoredFiles[module] = this.ignoredFiles[module];
        }, this);

        return clone;
    };

    CommonJsProject.prototype.addRoot = function(root) {
        this.roots.push(root);
    };

    function findModuleAt(baseObj, base, path) {
        if (isFile(base + path)) {
            if (baseObj) {
                console.log('- Found several matches for ' + module +
                    ' (ignoring 2nd)');
                console.log('  - ' + baseObj.base + baseObj.path);
                console.log('  - ' + base + path);
            }
            else {
                baseObj = { base: base, path: path };
            }
        }

        return baseObj;
    }

    function findRequires(baseObj) {
        var code = fs.readFileSync(baseObj.base + baseObj.path).toString();
        var ast;
        try {
            ast = ujs.parser.parse(code, false);
        }
        catch (ex) {
            console.error('- Failed to compile ' + baseObj.path + ': ' + ex);
        }

        var reply = [];
        var walkers = {
            'call': function(expr, args) {
                // TODO: bug - if anyone redefines 'require' we won't notice
                // we should maintain a list of declared variables in the
                // current scope so we can detect this.
                // A similar system could have us tracking calls to require
                // via a different name. that was a useful escape system, but
                // now we detect computed requires, it's not needed.
                if (expr[1] === 'require') {
                    var arg0 = args[0];
                    if (args[0][0] === 'string') {
                        reply.push(args[0][1]);
                    }
                    else {
                        console.log('- ' + baseObj.path + ' has require(...) ' +
                            'with non-string parameter. Ignoring requirement.');
                    }
                }
            }
        };

        var walker = ujs.uglify.ast_walker();
        walker.with_walkers(walkers, function() {
            return walker.walk(ast);
        });

        return reply;
    }

    var textPluginPattern = /^text!/;

    CommonJsProject.prototype.require = function(id, parent) {
        var module = id;
        if (parent && module.charAt(0) == '.') {
            module = path.join(path.dirname(parent), module);
        }
        
        module = removeTrailingSlash(module);

        var baseObj = this.currentFiles[module];
        if (baseObj) {
            return baseObj;
        }
        baseObj = this.ignoredFiles[module];
        if (baseObj) {
            return baseObj;
        }

        if (this.ignoreRequires.indexOf(module) > -1) {
            this.currentFiles[module] = new NullModule(module);
            return;
        }

        // Find which of the packages it is in
        this.roots.forEach(function(root) {
            var base = ensureTrailingSlash(root);
            if (textPluginPattern.test(module)) {
                baseObj = findModuleAt(baseObj, base, module.replace(textPluginPattern, ''));
                if (baseObj) {
                    baseObj.isText = true;
                }
            } else {
                baseObj = findModuleAt(baseObj, base, module + '.js');
                baseObj = findModuleAt(baseObj, base, path.join(module,'/index.js'));
            }
        }, this);

        if (!baseObj) {
            console.error('Failed to find module: ' + module);
            console.error('\tid: ', id, '\n\tparent: ', parent, '\n');
            return;
        }

        var deps = baseObj.deps = {};
        this.currentFiles[module] = baseObj;

        var isIndex = path.basename(baseObj.path).indexOf('index') == 0;

        if (!baseObj.isText) {
            // require() all this modules requirements
            findRequires(baseObj).forEach(function(req) {
                deps[req] = 1;
                var par = isIndex ? path.join(module, 'index') : module;
                this.require(req, par);
            }, this);
        }
    };

    CommonJsProject.prototype.getCurrentSources = function() {
        return Object.keys(this.currentFiles).map(function(module) {
            return this.currentFiles[module];
        }, this);
    };
})();

/**
 *
 */
copy.createCommonJsProject = function(roots) {
    return new CommonJsProject(roots);
};

/**
 * Different types of source
 */
copy.source = {};

/**
 *
 */
copy.source.commonjs = function(obj) {
    if (!obj.project) {
        if (typeof obj.root !== 'string') {
            throw new Error('Expected commonjs args to have root or project.');
        }
        if (!isDirectory(obj.root)) {
            throw new Error('commonjs root is not a file: ' + obj.root);
        }
        obj.root = ensureTrailingSlash(obj.root);
        obj.project = new CommonJsProject([ obj.root ]);
    }
    else if (!obj.project instanceof CommonJsProject) {
        throw new Error('commonjs project should be a CommonJsProject');
    }

    if (typeof obj.require === 'string') {
        obj.require = [ obj.require ];
    }
    if (!Array.isArray(obj.require)) {
        throw new Error('Expected commonjs args to have require.');
    }

    return function() {
        obj.require.forEach(function(module) {
            obj.project.require(module);
        });
        return obj.project.getCurrentSources();
    };
};

/**
 * File filters
 */
copy.filter = {};

copy.filter.debug = function(input, source) {
    source = source || 'unknown';
    source = source.path ? source.path : source;
    console.log(source);
    return input;
};
copy.filter.debug.onRead = true;

/**
 * Compress the given input code using UglifyJS.
 *
 * @param string input
 * @return string output
 */
copy.filter.uglifyjs = function(input) {
    if (typeof input !== 'string') {
        input = input.toString();
    }

    var opt = copy.filter.uglifyjs.options;
    var ast = ujs.parser.parse(input, opt.parse_strict_semicolons);

    if (opt.mangle) {
        ast = ujs.uglify.ast_mangle(ast, opt.mangle_toplevel);
    }

    if (opt.squeeze) {
        ast = ujs.uglify.ast_squeeze(ast, opt.squeeze_options);
        if (opt.squeeze_more) {
            ast = ujs.uglify.ast_squeeze_more(ast);
        }
    }

    return ujs.uglify.gen_code(ast, opt.beautify);
};
copy.filter.uglifyjs.onRead = false;
/**
 * UglifyJS filter options.
 */
copy.filter.uglifyjs.options = {
    parse_strict_semicolons: false,

    /**
     * The beautify argument used for process.gen_code(). See the UglifyJS
     * documentation.
     */
    beautify: false,
    mangle: true,
    mangle_toplevel: false,
    squeeze: true,

    /**
     * The options argument used for process.ast_squeeze(). See the UglifyJS
     * documentation.
     */
    squeeze_options: {},

    /**
     * Tells if you want to perform potentially unsafe compression.
     */
    squeeze_more: false
};

/**
 * A filter to munge CommonJS headers
 */
copy.filter.addDefines = function(input, source) {
    if (typeof input !== 'string') {
        input = input.toString();
    }

    if (!source) {
        throw new Error('Missing filename for moduleDefines');
    }

    if (source.base) {
        source = source.path;
    }

    input = input.replace(/"/g, '\\"');
    input = '"' + input.replace(/\n/g, '" +\n  "') + '"';

    return 'define("text!' + source.toString() + '", [], ' + input + ');\n\n';
};
copy.filter.addDefines.onRead = true;

/**
 * Like addDefines, but adds base64 encoding
 */
copy.filter.base64 = function(input, source) {
    if (typeof input === 'string') {
        throw new Error('base64 filter needs to be the first in a filter set');
    }

    if (!source) {
        throw new Error('Missing filename for moduleDefines');
    }

    if (source.base) {
        source = source.path;
    }

    if (source.substr(-4) === '.png') {
        input = 'data:image/png;base64,' + input.toString('base64');
    }
    else if (source.substr(-4) === '.gif') {
        input = 'data:image/gif;base64,' + input.toString('base64');
    }
    else {
        throw new Error('Only gif/png supported by base64 filter: ' + source);
    }

    return 'define("text!' + source + '", [], "' + input + '");\n\n';
};
copy.filter.base64.onRead = true;

/**
 * Munge define lines to add module names
 */
copy.filter.moduleDefines = function(input, source) {
    if (!source) {
        console.log('- Source without filename passed to moduleDefines().' +
            ' Skipping addition of define(...) wrapper.');
        return input;
    }

    if (source.isText) {
        return copy.filter.addDefines(input, source);
    }

    if (typeof input !== 'string') {
        input = input.toString();
    }

    var deps = source.deps ? Object.keys(source.deps) : [];
    deps = deps.length ? (", '" + deps.join("', '") + "'") : "";

    if (source.base) {
        source = source.path;
    }
    source = source.replace(/\.js$/, '');

    return input.replace(/\bdefine\(\s*function\s*\(require,\s*exports,\s*module\)\s*\{/,
        "define('" + source + "', ['require', 'exports', 'module' " + deps + "], function(require, exports, module) {");
};
copy.filter.moduleDefines.onRead = true;

function isFile(fullPath) {
    return path.existsSync(fullPath) && fs.statSync(fullPath).isFile();
}

function isDirectory(fullPath) {
    return path.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
}

/**
 * Add a trailing slash to s directory path if needed
 */
function ensureTrailingSlash(filename) {
    if (filename.length > 0 && filename.substr(-1) !== '/') {
        filename += '/';
    }
    return filename;
}

function removeTrailingSlash(filename) {
    if (filename.length > 0 && filename.substr(-1) === '/') {
        filename = filename.substr(0, filename.length -1);
    }
    return filename;
}

exports.copy = copy;
