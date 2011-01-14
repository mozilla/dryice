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

    if (filter.onRead == reading) {
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
    if (!findObj.path) {
        findObj.path = '';
    }

    if (findObj.root.length > 0 && findObj.root.substr(-1) !== '/') {
        findObj.root += '/';
    }
    var path = findObj.path;
    if (path.length > 0 && path.substr(-1) !== '/') {
        path += '/';
    }

    fs.readdirSync(findObj.root + findObj.path).forEach(function(entry) {
        var stat = fs.statSync(findObj.root + path + entry);
        if (stat.isFile()) {
            if (findObj.filter(path + entry)) {
                addSourceBase(obj, {
                    base: findObj.root,
                    path: path + entry
                });
            }
        }
        else if (stat.isDirectory()) {
            findObj.path = path + entry;
            copy.findFiles(obj, findObj);
        }
    }, this);
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
 * File filters
 */
copy.filter = {};

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

    return 'define("text!' + source.toString() + '", ' + input + ');\n\n';
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

    return 'define("text!' + source + '", "' + input + '");\n\n';
};
copy.filter.base64.onRead = true;

/**
 * Munge define lines to add module names
 */
copy.filter.moduleDefines = function(input, source) {
    if (typeof input !== 'string') {
        input = input.toString();
    }

    if (!source) {
        throw new Error('Missing filename for moduleDefines');
    }

    if (source.base) {
        source = source.path;
    }
    source = source.replace(/\.js$/, '');

    return input.replace(/\bdefine\(\s*function\(require,\s*exports,\s*module\)\s*\{/,
        "define('" + source + "', function(require, exports, module) {");
};
copy.filter.moduleDefines.onRead = true;


exports.copy = copy;
