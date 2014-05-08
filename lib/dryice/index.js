/*
 * Copyright 2012, Mozilla Foundation and contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var fs = require("fs");
var path = require("path");
var ujs = require("uglify-js");

if (!fs.existsSync) {
  fs.existsSync = path.existsSync;
}

/**
 * See https://github.com/mozilla/dryice for usage instructions.
 */
function copy(obj) {
  var filters = copy.filterFactory(obj.filter);
  var source = copy.sourceFactory(obj.source, filters);
  var dest = copy.destFactory(obj.dest, filters, obj.filenameFilter);
  dest.processSource(source);
}

/**
 * A Location is a base and a path which together point to a file or directory.
 * It's useful to be able to know in copy operations relative to some project
 * root to be able to remember where in a destination the file should go
 */
function Location(base, somePath) {
  if (base == null) {
    throw new Error('base == null');
  }
  this.base = base;
  this.path = somePath;
}

Location.prototype.isLocation = true;

Object.defineProperty(Location.prototype, 'fullname', {
  get: function() {
    return path.join(this.base, this.path);
  }
});

Object.defineProperty(Location.prototype, 'dirname', {
  get: function() {
    return path.dirname(this.fullname);
  }
});

/**
 * Select the correct implementation of Source for the given source property
 */
copy.sourceFactory = function(source, filters) {
  if (source == null) {
    throw new Error('Missing source');
  }

  if (source.isSource) {
    return source;
  }

  if (typeof source === 'string') {
    if (copy.isDirectory(source)) {
      return new copy.DirectorySource(source, null, null, filters);
    }
    else {
      return new copy.FileSource(new Location('', source), filters);
    }
  }

  if (Array.isArray(source)) {
    return new copy.ArraySource(source, filters);
  }

  if (typeof source === 'function') {
    return new copy.FunctionSource(source, filters);
  }

  if (source.root != null) {
    if (source.require != null) {
      var project = new CommonJsProject([ source.root ]);
      return new copy.CommonJsSource(project, source.require, filters);
    }

    return new copy.DirectorySource(source.root, source.include, source.exclude, filters);
  }

  if (source.base != null && source.path != null) {
    return new copy.FileSource(new Location(source.base, source.path), filters);
  }

  if (typeof source.value === 'string') {
    return new copy.ValueSource(source.value, null, filters);
  }

  if (source.project != null && source.require != null) {
    return new copy.CommonJsSource(source.project, source.require, filters);
  }

  throw new Error('Can\'t handle type of source: ' + typeof source);
};

copy.debug = false;

/**
 * Abstract Source.
 * Concrete implementations of Source should define the 'get' property.
 */
copy.Source = function() {
};

/**
 * @return Either another source, an array of other sources or a string value
 * when there is nothing else to dig into
 */
Object.defineProperty(copy.Source.prototype, 'get', {
  get: function() {
    throw new Error('Source.get is not implemented');
  }
});

copy.Source.prototype.isSource = true;

copy.Source.prototype._runFilters = function(value, location) {
  this._filters.forEach(function(filter) {
    if (filter.onRead) {
      value = filter(value, location);
    }
  }, this);
  return value;
};

/**
 * Default encoding for all sources
 */
copy.Source.prototype.encoding = 'utf8';

/**
 * An ArraySource is simply an array containing things that can resolve to
 * implementations of Source when passed to copy.sourceFactory()
 */
copy.ArraySource = function(array, filters) {
  copy.Source.call(this);
  this._array = array;
  this._filters = filters;
};

copy.ArraySource.prototype = Object.create(copy.Source.prototype);

Object.defineProperty(copy.ArraySource.prototype, 'get', {
  get: function() {
    return this._array.map(function(member) {
      return copy.sourceFactory(member, this._filters);
    }, this);
  }
});

/**
 * A FunctionSource is something that can be called to resolve to another
 * Source implementation
 */
copy.FunctionSource = function(func, filters) {
  copy.Source.call(this);
  this._func = func;
  this._filters = filters;
};

copy.FunctionSource.prototype = Object.create(copy.Source.prototype);

Object.defineProperty(copy.FunctionSource.prototype, 'get', {
  get: function() {
    return copy.sourceFactory(this._func(), this._filters);
  }
});

/**
 * A Source that finds files under a given directory with specified include /
 * exclude patterns.
 * @param root The root in the filesystem under which the files exist
 * @param filterOrInclude
 */
copy.DirectorySource = function(root, filterOrInclude, exclude, filters) {
  copy.Source.call(this);
  this._filters = filters;

  this.root = root;
  if (this.root instanceof CommonJsProject) {
    this.root = this.root.roots;
  }

  if (Array.isArray(this.root)) {
    this.root.map(function(r) {
      return ensureTrailingSlash(r);
    });
  }

  if (typeof filterOrInclude === 'function') {
    this._searchFilter = filterOrInclude;
  }
  else {
    this._searchFilter = this._createFilter(filterOrInclude, exclude);
  }
};

copy.DirectorySource.prototype = Object.create(copy.Source.prototype);

Object.defineProperty(copy.DirectorySource.prototype, 'get', {
  get: function() {
    return this._findMatches(this.root, '/');
  }
});

copy.DirectorySource.prototype._findMatches = function(root, path) {
  var sources = [];

  if (Array.isArray(root)) {
    root.forEach(function(r) {
      var matches = this._findMatches(r, path);
      sources.push.apply(sources, matches);
    }, this);
    return sources;
  }

  root = ensureTrailingSlash(root);
  path = ensureTrailingSlash(path);

  if (copy.isDirectory(root + path)) {
    fs.readdirSync(root + path).forEach(function(entry) {
      var stat = fs.statSync(root + path + entry);
      if (stat.isFile()) {
        if (this._searchFilter(path + entry)) {
          var location = new Location(root, path + entry);
          sources.push(new copy.FileSource(location, this._filters));
        }
      }
      else if (stat.isDirectory()) {
        var matches = this._findMatches(root, path + entry);
        sources.push.apply(sources, matches);
      }
    }, this);
  }

  return sources;
};

copy.DirectorySource.prototype._createFilter = function(include, exclude) {
  return function(pathname) {
    function noPathMatch(pattern) {
      return !pattern.test(pathname);
    }
    if (include instanceof RegExp) {
      if (noPathMatch(include)) {
        return false;
      }
    }
    if (typeof include === 'string') {
      if (noPathMatch(new RegExp(include))) {
        return false;
      }
    }
    if (Array.isArray(include)) {
      if (include.every(noPathMatch)) {
        return false;
      }
    }

    function pathMatch(pattern) {
      return pattern.test(pathname);
    }
    if (exclude instanceof RegExp) {
      if (pathMatch(exclude)) {
        return false;
      }
    }
    if (typeof exclude === 'string') {
      if (pathMatch(new RegExp(exclude))) {
        return false;
      }
    }
    if (Array.isArray(exclude)) {
      if (exclude.some(pathMatch)) {
        return false;
      }
    }

    return true;
  };
};

/**
 * A FileSource gets data directly from a file. It has 2 parts to the filename,
 * a base and path members, where filename = base + path.
 * FileSources are important when using CommonJS filters, because it tells the
 * filter where the root of the hierarchy is, which lets us know the module
 * name.
 * If there is no base to the filename, use a base of ''.
 */
copy.FileSource = function(location, filters) {
  copy.Source.call(this);
  this.location = location;
  this.name = location.fullname;
  this._filters = filters;
};

copy.FileSource.prototype = Object.create(copy.Source.prototype);

Object.defineProperty(copy.FileSource.prototype, 'get', {
  get: function() {
    var read = fs.readFileSync(this.name);
    return this._runFilters(read, this.location);
  }
});

/**
 *
 */
copy.ValueSource = function(value, location, filters) {
  copy.Source.call(this);
  this._value = value;
  this._location = location;
  this._filters = filters;
};

copy.ValueSource.prototype = Object.create(copy.Source.prototype);

Object.defineProperty(copy.ValueSource.prototype, 'get', {
  get: function() {
    return this._runFilters(this._value, this._location);
  }
});

/**
 * Read modules from a CommonJS Project using a require property.
 */
copy.CommonJsSource = function(project, require, filters) {
  copy.Source.call(this);
  this._project = project;
  this._filters = filters;

  if (!project instanceof CommonJsProject) {
    throw new Error('commonjs project should be a CommonJsProject');
  }

  if (typeof require === 'string') {
    this._require = [ require ];
  }
  else if (Array.isArray(require)) {
    this._require = require;
  }
  else {
    throw new Error('Expected commonjs args to have string/array require.');
  }
};

copy.CommonJsSource.prototype = Object.create(copy.Source.prototype);

Object.defineProperty(copy.CommonJsSource.prototype, 'get', {
  get: function() {
    this._require.forEach(function(moduleName) {
      this._project.require(moduleName, '<build file>');
    }, this);
    return this._project.getCurrentModules().map(function(location) {
      return new copy.FileSource(location, this._filters);
    }.bind(this));
  }
});


////////////////////////////////////////////////////////////////////////////////

copy.filterFactory = function(filter) {
  if (filter == null) {
    return [];
  }

  if (typeof filter === 'function') {
    return [ filter ];
  }

  if (Array.isArray(filter)) {
    return filter;
  }
};


////////////////////////////////////////////////////////////////////////////////

/**
 * Select the correct implementation of Destination for the given dest property
 */
copy.destFactory = function(dest, filters, filenameFilter) {
  if (dest == null) {
    throw new Error('Missing dest');
  }

  if (dest.isDestination) {
    return dest;
  }

  if (dest.value != null) {
    return new copy.ValueDestination(dest, filters);
  }

  if (typeof dest === 'string') {
    if (copy.isDirectory(dest)) {
      return new copy.DirectoryDestination(dest, filters, filenameFilter);
    }
    else {
      return new copy.FileDestination(dest, filters);
    }
  }

  if (Array.isArray(dest)) {
    return new copy.ArrayDestination(dest, filters);
  }

  throw new Error('Can\'t handle type of dest: ' + typeof dest);
};

/**
 * Abstract Destination.
 * Concrete implementations of Destination should define the 'processSource'
 * function.
 */
copy.Destination = function() {
};

copy.Destination.prototype.isDestination = true;

/**
 * @return Either another dest, an array of other sources or a string value
 * when there is nothing else to dig into
 */
copy.Destination.prototype.processSource = function(source) {
  throw new Error('Destination.processSource() is not implemented');
};

/**
 * Helper function to convert an input source to a single string value
 */
copy.Destination.prototype._sourceToOutput = function(source) {
  var data = source.get;

  if (data.isSource) {
    return this._sourceToOutput(data);
  }

  if (Array.isArray(data)) {
    var value = '';
    data.forEach(function(s) {
      value += this._sourceToOutput(s);
    }, this);
    return value;
  }

  if (typeof data === 'string') {
    return data;
  }

  // i.e. a Node Buffer
  if (typeof data.toString === 'function') {
    return data.toString();
  }

  throw new Error('Unexpected value from source.get');
};

copy.Destination.prototype._runFilters = function(value) {
  this._filters.forEach(function(filter) {
    if (!filter.onRead) {
      value = filter(value);
    }
  }, this);
  return value;
};

/**
 * A Destination that concatenates the sources and writes them to a single
 * output file.
 */
copy.FileDestination = function(filename, filters) {
  this._filename = filename;
  this._filters = filters;
};

copy.FileDestination.prototype = Object.create(copy.Destination.prototype);

copy.FileDestination.prototype.processSource = function(source) {
  var data = this._sourceToOutput(source);
  data = this._runFilters(data);
  copy._writeToFile(this._filename, data);
};

/**
 * A Destination that copies the sources to new files in an alternate directory
 * structure.
 */
copy.DirectoryDestination = function(dirname, filters, filenameFilter) {
  this.name = dirname;
  this._filters = filters;
  this._filenameFilter = filenameFilter;
};

copy.DirectoryDestination.prototype = Object.create(copy.Destination.prototype);

copy.DirectoryDestination.prototype.processSource = function(source) {
  var data = source.get;
  if (typeof data === 'string') {
    throw new Error('Can\'t write raw data to a directory');
  }
  else if (data.isSource) {
    var destfile = path.join(this.name, data.location.path);
    if (this._filenameFilter != null) {
      destfile = this._filenameFilter(destfile);
    }
    var output = this._runFilters(data.get);
    copy._writeToFile(destfile, output, data.encoding);
  }
  else if (Array.isArray(data)) {
    data.forEach(function(s) {
      var destfile = path.join(this.name, s.location.path);
      if (this._filenameFilter != null) {
        destfile = this._filenameFilter(destfile);
      }
      var output = this._runFilters(s.get);
      copy._writeToFile(destfile, output, s.encoding);
    }, this);
  }
  else {
    throw new Error('data is not a source, string, nor can it be converted');
  }
};

/**
 * ArrayDestination is a Destination that can feed sources to a number of child
 * Destinations.
 */
copy.ArrayDestination = function(array, filters) {
  this._array = array;
  this._filters = filters;
};

copy.ArrayDestination.prototype = Object.create(copy.Destination.prototype);

copy.ArrayDestination.prototype.processSource = function(source) {
  this._array.forEach(function(member) {
    var dest = copy.destFactory(member, this._filters);
    dest.processSource(source);
  }, this);
};

/**
 * A Destination that concatenates the sources and writes them to a single
 * value object.
 */
copy.ValueDestination = function(value, filters) {
  this._value = value;
  this._filters = filters;
};

copy.ValueDestination.prototype = Object.create(copy.Destination.prototype);

copy.ValueDestination.prototype.processSource = function(source) {
  var data = this._sourceToOutput(source);
  data = this._runFilters(data);
  this._value.value += data;
};

////////////////////////////////////////////////////////////////////////////////

/**
 * Check to see if fullPath refers to a directory
 */
copy.isDirectory = function(fullPath) {
  return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
};

copy._writeToFile = function(filename, data, encoding) {
  if (fs.existsSync(filename)) {
    if (!fs.statSync(filename).isFile()) {
      throw new Error('Refusing to remove non file: ' + filename);
    }
    fs.unlinkSync(filename);
  }
  var parent = path.dirname(filename);
  if (!fs.existsSync(parent)) {
    copy.mkdirSync(parent, 0755);
  }
  fs.writeFileSync(filename, data, encoding);
  if (copy.debug) {
    console.log('- wrote ' + data.length + ' bytes to ' + filename);
  }
};

copy.mkdirSync = function(dirname, mode) {
  if (copy.isDirectory(dirname)) {
    return;
  }
  var parent = path.dirname(dirname);
  if (!fs.existsSync(parent)) {
    copy.mkdirSync(parent, mode);
  }
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, mode);
  }
};

////////////////////////////////////////////////////////////////////////////////

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
 * Read mini_require.js to go with the required modules.
 */
copy.getMiniRequire = function() {
  return {
    value: fs.readFileSync(__dirname + '/mini_require.js').toString('utf8')
  };
};

/**
 * Keep track of the files in a project
 */
function CommonJsProject(opts) {
  this.roots = opts.roots;
  this.aliases = opts.aliases;
  this.textPluginPattern = opts.textPluginPattern || /^text!/;

  opts.roots = this.roots.map(function(root) {
    if (!copy.isDirectory(root)) {
      throw new Error('Each commonjs root should be a directory: ' + root);
    }
    return ensureTrailingSlash(root);
  }, this);

  // A module is a Location that also has dep
  this.currentModules = {};
  this.ignoredModules = {};
}

CommonJsProject.prototype.report = function() {
  var reply = 'CommonJS project at ' + this.roots.join(', ') + '\n';

  reply += '- Required modules:\n';
  var moduleNames = Object.keys(this.currentModules);
  if (moduleNames.length > 0) {
    moduleNames.forEach(function(module) {
      var deps = Object.keys(this.currentModules[module].deps).length;
      reply += '  - ' + module + ' (' + deps +
          (deps === 1 ? ' dependency' : ' dependencies') + ')\n';
    }, this);
  }
  else {
    reply += '  - None\n';
  }

  reply += '- Ignored modules:\n';
  var ignoredNames = Object.keys(this.ignoredModules);
  if (ignoredNames.length > 0) {
    ignoredNames.forEach(function(moduleName) {
      reply += '  - ' + moduleName + '\n';
    }, this);
  }
  else {
    reply += '  - None\n';
  }

  return reply;
};

/**
 * Create an experimental GraphML string declaring the node dependencies.
 */
CommonJsProject.prototype.getDependencyGraphML = function() {
  var nodes = '';
  var edges = '';
  var moduleNames = Object.keys(this.currentModules);
  moduleNames.forEach(function(moduleName) {
    nodes += '    <node id="' + moduleName + '">\n';
    nodes += '      <data key="d0">\n';
    nodes += '        <y:ShapeNode>\n';
    nodes += '           <y:NodeLabel textColor="#000000">' + moduleName + '</y:NodeLabel>\n';
    nodes += '        </y:ShapeNode>\n';
    nodes += '      </data>\n';
    nodes += '    </node>\n';
    var deps = Object.keys(this.currentModules[moduleName].deps);
    deps.forEach(function(dep) {
        edges += '    <edge source="' + moduleName + '" target="' + dep + '"/>\n';
    });
  }, this);

  var reply = '<?xml version="1.0" encoding="UTF-8"?>\n';
  reply += '<graphml\n';
  reply += '    xmlns="http://graphml.graphdrawing.org/xmlns/graphml"\n';
  reply += '    xmlns:y="http://www.yworks.com/xml/graphml"\n';
  reply += '    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
  reply += '    xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns/graphml http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd"\n';
  reply += '    >\n';
  reply += '  <key id="d0" for="node" yfiles.type="nodegraphics"/>\n';
  reply += '  <key id="d1" for="edge" yfiles.type="edgegraphics"/>\n';
  reply += '  <graph id="commonjs" edgedefault="undirected">\n';
  reply += nodes;
  reply += edges;
  reply += '  </graph>\n';
  reply += '</graphml>\n';
  return reply;
};

CommonJsProject.prototype.assumeAllFilesLoaded = function() {
  Object.keys(this.currentModules).forEach(function(moduleName) {
    this.ignoredModules[moduleName] = this.currentModules[moduleName];
  }, this);
  this.currentModules = {};
};

CommonJsProject.prototype.clone = function() {
  var clone = new CommonJsProject({
    roots: this.roots,
    textPluginPattern: this.textPluginPattern
  });

  clone.aliases = this.aliases;

  Object.keys(this.currentModules).forEach(function(moduleName) {
    clone.currentModules[moduleName] = this.currentModules[moduleName];
  }, this);

  Object.keys(this.ignoredModules).forEach(function(moduleName) {
    clone.ignoredModules[moduleName] = this.ignoredModules[moduleName];
  }, this);

  return clone;
};

CommonJsProject.prototype.addRoot = function(root) {
  this.roots.push(root);
};

function findModuleAt(module, base, somePath) {
  if (base == null) {
    throw new Error('base == null for ' + somePath);
  }
  // Checking for absolute requires and relative requires that previously
  // had been resolved to absolute paths.
  if (/^\//.test(somePath)) {
    if (isFile(somePath)) {
      console.log('Warning - using location with base = "/"');
      return new Location('/', somePath);
    }
  }

  if (isFile(path.join(base, somePath))) {
    if (module) {
      console.log('- Found several matches for ' + somePath +
          ' (ignoring 2nd)');
      console.log('  - ' + module.fullname);
      console.log('  - ' + path.join(base, somePath));
    }
    else {
      module = new Location(base, somePath);
    }
  }

  return module;
}

function relative(pathA, pathB) {
  pathA = pathA.split(/[\/\\]+/);
  pathB = pathB.split(/[\/\\]+/);
  var aLen = pathA.length;
  var bLen = pathB.length;

  // Increment i to the first place where the paths diverge.
  for (var i = 0; i < aLen && i < bLen && pathA[i] === pathB[i]; i++) {
  }

  // Remove the redundant parts of the paths.
  function isntEmptyString(s) {
    return s !== '';
  }
  pathA = pathA.slice(i).filter(isntEmptyString);
  pathB = pathB.slice(i).filter(isntEmptyString);

  var result = [];
  for (i = 0; i < pathA.length; i++) {
    result.push('..');
  }
  return result.concat(pathB).join('/');
}

function normalizeRequire(module, moduleName) {
  if (moduleName.indexOf("!") !== -1) {
    var chunks = moduleName.split("!");
    return normalizeRequire(module, chunks[0]) + "!" +
        normalizeRequire(module, chunks[1]);
  }

  if (moduleName.charAt(0) == ".") {
    var requirersDirectory = module.dirname;
    var pathToRequiredModule = path.join(requirersDirectory, moduleName);
    // The call to `define` which makes the module being
    // relatively required isn't the full relative path,
    // but the path relative from the base.
    return relative(module.base, pathToRequiredModule);
  }
  else {
    return moduleName;
  }
}

function findRequires(module) {
  var code = fs.readFileSync(module.fullname).toString();
  var ast;
  try {
    ast = ujs.parser.parse(code, false);
  }
  catch (ex) {
    console.error('- Failed to compile ' + module.path + ': ' + ex);
    return;
  }

  var reply = [];
  var walkers = {
    call: function(expr, args) {
      // If anyone redefines 'require' we won't notice. We could maintain a
      // list of declared variables in the current scope so we can detect this.
      // A similar system could have us tracking calls to require via a
      // different name. that was a useful escape system, but now we detect
      // computed requires, it's not needed.
      if (expr[1] === 'define') {
        var params = null;
        if (args[0][0] === 'array') {
          params = args[0][1];
        }
        else if (args[0][0] === 'string' && args[1][0] == 'array') {
          params = args[1][1];
        }
        // Check if it's a Simplified CommonJS Wrapper.  A module is only
        // treated as a CJS module if it doesn't contain a dependency array and
        // the definition function contains at least one parameter.
        // http://requirejs.org/docs/api.html#cjsmodule
        else if ((args[0][0] === 'function' && args[0][2].length) ||
                 (args[1][0] === 'function' && args[1][2].length &&
                  args[0][0] === 'string')) {
          // By definition there are no dependencies, so no more work is
          // necessary.
          return;
        }
        else {
          /*
          console.log('- ' + module.path + ' has define(...) ' +
              'with unrecognized parameter. Ignoring requirement.');
          */
          return;
        }

        if (params) {
          for (var i = 0; i < params.length; i++) {
            param = params[i];
            if (param[0] === 'string') {
              reply.push(normalizeRequire(module, param[1]));
            }
            else {
              console.log('- ' + module.path + ' has define(...) ' +
                  'with non-string parameter. Ignoring requirement.');
            }
          }
        }
      }
      if (expr[1] === 'require') {
        if (args[0][0] === 'string') {
          reply.push(normalizeRequire(module, args[0][1]));
        }
        else {
          console.log('- ' + module.path + ' has require(...) ' +
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

CommonJsProject.prototype.require = function(moduleName, parentModuleName) {
  var module = this.currentModules[moduleName];
  if (module) {
    return module;
  }
  module = this.ignoredModules[moduleName];
  if (module) {
    return module;
  }

  // Apply aliases on module path.
  if (this.aliases) {
    var parts = moduleName.split("/");
    var moduleName = parts.pop();

    var self = this;
    var resolved = parts.map(function(part) {
    var alias = self.aliases[part];
      return alias ? alias : part;
    });

    var moduleUrl = ensureTrailingSlash(resolved.join("/"));
    moduleName = moduleUrl + moduleName;
  }

  // Find which of the packages it is in
  this.roots.forEach(function(base) {
    if (this.textPluginPattern.test(moduleName)) {
      var modulePath = moduleName.replace(this.textPluginPattern, '');
      module = findModuleAt(module, base, modulePath);
      if (module) {
        module.isText = true;
      }
    } else {
      module = findModuleAt(module, base, moduleName + '.js');
      if (!module) {
        module = findModuleAt(module, base, moduleName + '/index.js');
      }
    }
  }, this);

  if (!module) {
    console.error('Failed to find module: ' + moduleName + ' from ' + parentModuleName);
    return;
  }

  module.deps = {};
  this.currentModules[moduleName] = module;

  if (!module.isText) {
    // require() all this modules requirements
    findRequires(module).forEach(function(innerModuleName) {
      module.deps[innerModuleName] = 1;
      this.require(innerModuleName, moduleName);
    }, this);
  }
};

CommonJsProject.prototype.getCurrentModules = function() {
  return Object.keys(this.currentModules).map(function(moduleName) {
    return this.currentModules[moduleName];
  }, this);
};

/**
 *
 */
copy.createCommonJsProject = function(opts) {
  return new CommonJsProject(opts);
};

/**
 * Different types of source
 */
copy.source = {};

/**
 * @deprecated
 */
copy.source.commonjs = function(obj) {
  console.log('copy.source.commonjs is deprecated, ' +
      'pass { project:... includes:...} directly as a source');
  return obj;
};

/**
 * File filters
 */
copy.filter = {};

copy.filter.debug = function(input, source) {
  source = source || 'unknown';
  module = source.path ? source.path : source;
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
  var ast;
  try {
    ast = ujs.parser.parse(input, opt.parse_strict_semicolons);
  }
  catch (ex) {
    console.error('- Failed to compile code: ' + ex);
    return input;
  }

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

  var module = source.isLocation ? source.path : source;

  input = input.replace(/\\/g, "\\\\").replace(/'/g, '\\\'');
  input = '\'' + input.replace(/\n/g, '\\n\' +\n  \'') + '\'';

  return 'define(\'text!' + module + '\', [], ' + input + ');\n\n';
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

  var module = source.isLocation ? source.path : source;

  if (module.substr(-4) === '.png') {
    input = 'data:image/png;base64,' + input.toString('base64');
  }
  else if (module.substr(-4) === '.gif') {
    input = 'data:image/gif;base64,' + input.toString('base64');
  }
  else {
    throw new Error('Only gif/png supported by base64 filter: ' + source);
  }

  return 'define("text!' + module + '", [], "' + input + '");\n\n';
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

  var module = source.isLocation ? source.path : source;
  module = module.replace(/\.js$/, '');

  return input.replace(/\bdefine\s*\(\s*function\s*\(require,\s*exports,\s*module\)\s*\{/,
      "define('" + module + "', ['require', 'exports', 'module' " + deps + "], function(require, exports, module) {");
};
copy.filter.moduleDefines.onRead = true;

/**
 * Why does node throw an exception for statSync(), especially when it has no
 * exists()?
 */
function isFile(fullPath) {
  return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
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


exports.copy = copy;
