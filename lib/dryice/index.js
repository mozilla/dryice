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
 *   Kevin Dangoor (kdangoor@mozilla.com)
 *   Mihai Sucan <mihai.sucan@gmail.com>
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

var sys = require("sys");
var fs = require("fs");
var Step = require("step");
var ujs = require("uglify-js");

var input_filters = {
    moduleDefines: function(input, filename) {
        if (!filename) {
            return input;
        }

        var module = filename.replace(/\.js$/, "");

        return input.replace(/\bdefine\(\s*function\(require,\s*exports,\s*module\)\s*\{/,
            "define('" + module + "', function(require, exports, module) {");
    },

    /**
     * Compress the given input code using UglifyJS.
     *
     * @param string input
     * @return string output
     */
    uglifyjs: function(input) {
        var opt = this.uglifyjs_options;
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
    },
};

var builder = function() {
};

builder.prototype = {
    DEBUG: false,

    /**
     * Base directory used for reading and writing files.
     */
    basedir: ".",

    /**
     * List of script files to read.
     */
    input_files: [],
    input_encoding: "utf8",

    /**
     * List of functions or filter names that process each input file.
     */
    input_filters: [],

    /**
     * List of functions or filter names that process the concatenated output
     * file.
     */
    output_filters: [],
    output_encoding: "utf8",

    /**
     * Output file. This can be a writeable stream or a file name (string).
     */
    output_file: process.stdout,

    /**
     * UglifyJS filter options.
     */
    uglifyjs_options: {
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
        squeeze_more: false,
    },

    log: sys.puts,

    debug: function(message) {
        if (this.DEBUG) {
            this.log(message);
        }
    },

    run: function(buildCallback) {
        var self = this;

        Step(
            function readFiles() {
                var i = -1;
                var next_step = this;
                var results = [];

                function readFile() {
                    i++;
                    if (i < self.input_files.length) {
                        fs.readFile(self.basedir + "/" + self.input_files[i],
                                    self.input_encoding, readCallback);
                    } else {
                        next_step(undefined, results);
                    }
                }

                function readCallback(err, data) {
                    if (err) {
                        next_step(err, results);
                    } else {
                        data = self.run_filters(self.input_filters, data,
                                                self.input_files[i]);
                        results.push(data);
                        readFile();
                    }
                }

                readFile();
            },

            function postProcessOutput(err, output) {
                if (err) {
                    throw err;
                }

                output = output.join("\n");
                output = self.run_filters(self.output_filters, output);

                if (typeof self.output_file == "string") {
                    fs.writeFile(self.basedir + "/" + self.output_file,
                                 output, self.output_encoding, this);
                } else {
                    self.output_file.write(output);
                    self.output_file.end();
                    return 1;
                }
            },

            function buildComplete(err) {
                buildCallback(err, self);
            }
        );
    },

    /**
     * Given an array of filters (functions or filter names), run these on the input
     * content.
     *
     * @param array filters
     * @param string input
     * @param string [filename] Optional filename, useful for some filters.
     * @return string Final filtered output.
     */
    run_filters: function(filters, input, filename) {
        filters.forEach(function(filter) {
            if (typeof filter == "string") {
                input = input_filters[filter].call(this, input, filename);
            } else {
                input = filter.call(this, input, filename);
            }
        }, this);
        return input;
    },
};


/*** Exports ***/
exports.build = builder;
exports.filters = input_filters;

