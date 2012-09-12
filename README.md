DryIce
======

DryIce is a CommonJS/RequireJS packaging tool for browser scripts.

It is basically just a copy function. It takes input from a set of input files,
which can be specified in various ways, optionally filters them and outputs them
to something else.

DryIce is licensed under the Apache License version 2


Why?
----

RequireJS has a build tool which is nice and works well, but it requires Rhino
and therefore Java. With DryIce, your whole build process can be in JavaScript.

DryIce produces a single file output that can include binary files (by base64
encoding them)


How to install DryIce
---------------------

    sudo npm install dryice


How does it work?
-----------------

To copy a single file:

    copy({
      source: 'foo.txt',
      dest: 'bar.txt'
    });

To cat a bunch of files together:

    copy({
      source: [ 'file1.js', 'file2.js' ],
      dest: 'output.js'
    });

To cat together all the files in a directory:

    copy({
      source: { root:'src' },
      dest: 'built.js'
    });

As above, but only use the JavaScript files:

    copy({
      source: { root:'src', include:/.*\.js$/ },
      dest: 'built.js'
    });

As above, but exclude tests:

    copy({
      source: { root:'src', include:/.*\.js$/: exclude:/test/ },
      dest: 'built.js'
    });

If your set of files is very custom:

    copy({
      source: function() {
        var files = [ 'file1.js' ];
        if (baz) files.push('file2.js');
        return files;
      },
      dest: 'built.js'
    });

We can filter the files on the way:

    copy({
      source: /src/.*\.js$/,
      filter: copy.filter.uglifyjs,
      dest: 'built.js'
    });

This includes running multiple custom filters:

    copy({
      source: 'src/index.html',
      filter: [
        function(data) {
          return data.replace(/Sun/, 'Oracle');
        },
        htmlCompressor
      ],
      dest: 'war/index.html'
    });

Results can be stored and then used/reused:

    var sources = copy.createDataObject();
    copy({
      source: { root: 'src1' },
      dest: sources
    });
    copy({
      source: { root: 'src2' },
      dest: sources
    });
    copy({
      source: sources,
      dest: 'sources-uncompressed.js'
    });
    copy({
      source: sources,
      filter: copy.filter.uglifyjs,
      dest: 'sources.js'
    });

Data objects are just JS objects with a 'value' member, so you can do all sorts
of things with them:

    var test = copy.createDataObject();
    copy({
      source: 'README.txt',
      dest: test
    });
    console.log(test.value);

Or:

    copy({
      source: { value: 'Hello, World!' },
      dest: 'basic.txt'
    });

And you can mix and match your inputs:

    copy({
      source: [
        'somefile.txt',
        thingDataObject,
        { root: 'src', include: /.*\.js$/ },
        function() { return 'wibble.sh'; }
      ],
      dest: 'mess.bin'
    });

Common JS project dependency tracking:

    var project = copy.createCommonJsProject({
        roots: [
            '/path/to/source/tree/lib',
            '/some/other/project/lib'
        ]
    });
    copy({
        source: copy.source.commonjs({
            project: project,
            require: [ 'main', 'plugin/main' ]
        }),
        dest: ''
    });

This digs around in the project source trees specified in the project for
modules named in the 'require' statement. When it finds them it looks through
them for require statements, and finds those, and so on.


Formal Parameter Description
----------------------------

The copy function takes a single parameter which is an object with 2 or 3
members: `source`, `dest` and optionally `filter`.

### source

There are 6 ways to specify the input source(s)

* A *string* is expected to point to a filename.
  At some stage we may allow them to point at directories too, however this
  can be achieved today using a find object (see below)

* A *find object* points to a directory with 2 optional RegExps specifying what
  to exclude and include. e.g.

    { root: '/' }                       -> The entire filesystem
    { root: 'src', include: /.*\.js$/ } -> All the JavaScript files in 'src'
    { root: 'src', exclude: /test/ }    -> All non-test files under 'src'

* A *data object* - something with a 'value' property.
  The implementation of `copy.createDataObject()` is simply
  `return { value: '' };`. We've batted around some ideas which involve making
  `copy.createDataObject()` smarter than it currently is, so it is advised to
  use this method rather than doing it yourself.

* A *based object*. A based object is one with `base` and `path` members. They
  are roughly the same as the string baseObj.base + baseObj.path. Based objects
  are important when using CommonJS filters, because it tells the filter where
  the root of the hierarchy is, which lets us know the module name.
  For example:

    { base: '/etc', path:PATH } where BASE+PATH = filename

* An *array* containing input source entries. The array does not have to be
  homogeneous.

* A *function* which returns any input source entries.

### filter

The filter member is optional. If it exists, it should contain either a function
or an array of functions. The function should have the following signature:

    function filter(value, location) {
      ..
      return 'some string';
    }

Where the parameters are as follows:

* value. Either a string or a node Buffer. Most filters will work only with
  strings, so they should begin:

      if (typeof value !== 'string') {
          value = value.toString();
      }

  Some filters will only work with Buffers (for example the base64 encoding
  filter) so they should begin:

      if (typeof value === 'string') {
          throw new Error('base64 filter needs to be the first in a filter set');
      }

  At some stage we may allow filters to be marked up as to their requirements.

* location. This will be (where possible) a based object or it could be a
  string if a based object is not available. It will be common to use one of the
  following idioms to work on a filename:

      if (location.base) {
          location = location.path;
      }

  or

      if (location.base) {
          location = location.base + location.path;
      }

There are 2 points in a copy run where filters could be used, either before the
individual sources are concatenated, or after. Some filters should be used in
before (like common-js munging filters) and some afterwards (like compressors).

The default is to run filters after concatenation (when the location parameter
will be undefined). To run filters before concatenation, the filter should be
marked with `onRead = true`. For example:

    function makeBlank(value, location) {
      return '';
    }
    makeBlank.onRead = true;

DryIce currently comes with 4 filters:

* _copy.filter.uglifyjs_: Calls uglify on the input.
* _copy.filter.addDefines_: Wraps the input to inline files fetched using
  RequireJSs text import feature.
* _copy.filter.base64_: Similar to addDefines, but assumes the input is
  binary and should be base64 encoded.
* _copy.filter.moduleDefines_: Replaces define lines to include the module name
  e.g. `define(function(export, require, module) { ... });` is turned into
  `define('module/name', function(export, require, module) { ... });`


### dest

The dest property should be either a filename to which the output should be
written (existing files will be over-written without warning), or a data object
to which the data should be appended.

CommonJS Projects
-----------------

CommonJS projects take a single object with the following properties:

* `roots`: This is required. An array of directories that should be searched for
  your required modules and dependencies.

* `ignores`: This is optional. An array of modules or dependencies that are
  required by your project that you would not like to be included in the
  build. For example, if you were making a build which did not need to support
  IE, you could do something like the following

        copy.createCommonJsProject({
            roots: [ '/path/to/project' ],
            ignores: [ 'dom/ie-compat', 'event/ie-compat' ]
        });

  then wherever you had `require('dom/ie-compat')` or
  `require('event/ie-compat')` inside your build, `undefined` would be returned
  by `require`.

Where (is the project going)?
-----------------------------

DryIce is useful in combining scripts for the browser, but it could also be
used in a similar role on the server, we just need to enable 'pass through
requires'.

There are some tweaks we'd still like to make to enable more filters and
multiple destinations:

To recursively copy a directory:

    copy({ source: 'foo', destDir: 'bar' });

To rename files as we copy them:

    copy({
      source: { root:'src', include:/.*\.png$/ },
      destDir: { root:'built', replace:/png$/, with:'png.bak' }
    });

To create a tarball (this is only missing the targz filter):

    var version = copy.createDataObject();
    copy({ source: 'VERSION.txt', dest: version });
    copy({
      source: { root:'.' },
      filter: [ targz ],
      dest: 'scp://example.com/upload/myproject-' + version + '.tar.gz'
    });

I don't suppose you would ever actually want to do this, but in theory you
could even do this:

    copy({
      source: { root:'src', include:/.*\.java$/ },
      filter: javac,
      destDir: { root:'classes', replace:/java$/, with:'class' }
    });

(Actually there would be issues with ordering that would make this hard, and
Ant/Maven/etc is probably better. This is an illustration dammit!)
