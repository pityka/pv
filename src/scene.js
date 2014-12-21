// Copyright (c) 2013-2014 Marco Biasini
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

(function(exports) {

"use strict";

function Range(min, max) {
  if (min === undefined || max === undefined) {
    this._empty = true;
    this._min = this._max = null;
  } else {
    this._empty = false;
    this._min = min;
    this._max = max;
  }
}

Range.prototype = {
  min : function() {
    return this._min;
  },
  max : function() {
    return this._max;
  },
  length : function() {
    return this._max - this._min;
  },
  empty : function() {
    return this._empty;
  },
  center : function() {
    return (this._max + this._min) * 0.5;
  },

  extend : function(amount) {
    this._min -= amount;
    this._max += amount;
  },

  update : function(val) {
    if (!this._empty) {
      if (val < this._min) {
        this._min = val;
      } else if (val > this._max) {
        this._max = val;
      }
      return;
    }
    this._min = this._max = val;
    this._empty = false;
  }
};


// A scene node holds a set of child nodes to be rendered on screen. Later on,
// the SceneNode might grow additional functionality commonly found in a scene
// graph, e.g. coordinate transformations.
function SceneNode(gl) {
  this._children = [];
  this._visible = true;
  this._name = name || '';
  this._gl = gl;
  this._order = 1;
}


SceneNode.prototype = {

  order : function(order) {
    if (order !== undefined) {
      this._order = order;
    }
    return this._order;
  },

  add : function(node) {
    this._children.push(node);
  },

  draw : function(cam, shaderCatalog, style, pass) {
    for (var i = 0, e = this._children.length; i !== e; ++i) {
      this._children[i].draw(cam, shaderCatalog, style, pass);
    }
  },

  show : function() {
    this._visible = true;
  },

  hide : function() {
    this._visible = false;
  },

  name : function(name) {
    if (name !== undefined) {
      this._name = name;
    }
    return this._name;
  },

  destroy : function() {
    for (var i = 0; i < this._children.length; ++i) {
      this._children[i].destroy();
    }
  },

  visible : function() {
    return this._visible;
  }
};

function eachCentralAtomAsym(structure, callback) {
  structure.eachResidue(function(residue) {
    var centralAtom = residue.centralAtom();
    if (centralAtom === null) {
      return;
    }
    callback(centralAtom, centralAtom.pos());
  });
}

var eachCentralAtomSym = (function() {
  var transformedPos = vec3.create();
  return function(structure, gens, callback) {
    for (var i = 0; i < gens.length; ++i) {
      var gen = gens[i];
      var chains = structure.chainsByName(gen.chains());
      for (var j = 0; j < gen.matrices().length; ++j) {
        var matrix = gen.matrix(j);
        for (var k = 0; k < chains.length; ++k) {
          var chain = chains[k];
          for (var l = 0; l < chain.residues().length; ++l) {
            var centralAtom = chain.residues()[l].centralAtom();
            if (centralAtom === null) {
              continue;
            }
            vec3.transformMat4(transformedPos, centralAtom.pos(), matrix);
            callback(centralAtom, transformedPos);
          }
        }
      }
    }
  };
})();

function BaseGeom(gl) {
  SceneNode.call(this, gl);
  this._idRanges = [];
  this._vertAssocs = [];
  this._showRelated = null;
}

derive(BaseGeom, SceneNode, {
  setShowRelated : function(rel) {
    this._showRelated = rel;
    return rel;
  },

  symWithIndex : function(index) {
    if (this.showRelated() === 'asym') {
      return null;
    }
    var assembly = this.structure().assembly(this.showRelated());
    if (!assembly) {
      return null;
    }
    var gen = assembly.generators();
    for (var i = 0 ; i < gen.length; ++i) {
      if (gen[i].matrices().length > index) {
        return gen[i].matrix(index);
      }
      index -= gen[i].matrices().length;
    }
    return null;
  },

  showRelated : function() {
    return this._showRelated;
  },

  select : function(what) {
    return this.structure().select(what);
  },

  structure : function() {
    return this._vertAssocs[0]._structure;
  },


  getColorForAtom : function(atom, color) {
    // FIXME: what to do in case there are multiple assocs?
    return this._vertAssoc[0].getColorForAtom(atom, color);
  },

  addIdRange : function(range) {
    this._idRanges.push(range);
  },

  destroy : function() {
    SceneNode.prototype.destroy.call(this);
    for (var i = 0; i < this._idRanges.length; ++i) {
      this._idRanges[i].recycle();
    }
  },

  eachCentralAtom : function(callback) {
    var go = this;
    var structure = go.structure();
    var assembly = structure.assembly(go.showRelated());
    // in case there is no assembly, just loop over all the atoms contained
    // in the structure and invoke the callback as is
    if (assembly === null) {
      return eachCentralAtomAsym(structure, callback);
    }
    return eachCentralAtomSym(structure, assembly.generators(), callback);
  },

  addVertAssoc : function(assoc) {
    this._vertAssocs.push(assoc);
  },

  // returns all vertex arrays that contain geometry for one of the specified
  // chain names. Typically, there will only be one array for a given chain,
  // but for larger chains with mesh geometries a single chain may be split
  // across multiple vertex arrays.
  _vertArraysInvolving : function(chains) {
    var vertArrays = this.vertArrays();
    var selectedArrays = [];
    var set = {};
    for (var ci = 0; ci < chains.length; ++ci) {
      set[chains[ci]] = true;
    }
    for (var i = 0; i < vertArrays.length; ++i) {
      if (set[vertArrays[i].chain()] === true) {
        selectedArrays.push(vertArrays[i]);
      }
    }
    return selectedArrays;
  },


  // draws vertex arrays by using the symmetry generators contained in assembly
  _drawSymmetryRelated : function(cam, shader, assembly) {
    var gens = assembly.generators();
    for (var i = 0; i < gens.length; ++i) {
      var gen = gens[i];
      var affectedVertArrays = this._vertArraysInvolving(gen.chains());
      this._drawVertArrays(cam, shader, affectedVertArrays, gen.matrices());
    }
  },

  _updateProjectionIntervalsAsym : 
      function(xAxis, yAxis, zAxis, xInterval, yInterval, zInterval) {
      var vertArrays = this.vertArrays();
      for (var i = 0; i < vertArrays.length; ++i) {
        vertArrays[i].updateProjectionIntervals(xAxis, yAxis, zAxis, xInterval, 
                                                yInterval, zInterval);
      }
  },

  updateProjectionIntervals :
      function(xAxis, yAxis, zAxis, xInterval, yInterval, zInterval) {
    if (!this._visible) {
      return;
    }
    var showRelated = this.showRelated();
    if (showRelated === 'asym') {
      return this._updateProjectionIntervalsAsym(xAxis, yAxis, zAxis, xInterval, 
                                                yInterval, zInterval);
    } 
    var assembly = this.structure().assembly(showRelated);
    // in case there is no assembly, fallback to asymmetric unit and bail out.
    if (!assembly) {
      console.error('no assembly', showRelated, 
                    'found. Falling back to asymmetric unit');
      return this._updateProjectionIntervalsAsym(xAxis, yAxis, zAxis, xInterval, 
                                                yInterval, zInterval);
    }
    var gens = assembly.generators();
    for (var i = 0; i < gens.length; ++i) {
      var gen = gens[i];
      var affectedVertArrays = this._vertArraysInvolving(gen.chains());
      for (var j = 0; j < gen.matrices().length; ++j) {
        for (var k = 0; k < affectedVertArrays.length; ++k) {
          var transform = gen.matrix(j);
          affectedVertArrays[k].updateProjectionIntervals(xAxis, yAxis, zAxis, 
                                                          xInterval, yInterval, 
                                                          zInterval, transform);
        }
      }
    }
  },

  // FIXME: investigate the performance cost of sharing code between updateSquaredSphereRadius
  // and updateProjectionIntervals 
  _updateSquaredSphereRadiusAsym : function(center, radius) {
      var vertArrays = this.vertArrays();
      for (var i = 0; i < vertArrays.length; ++i) {
        radius = vertArrays[i].updateSquaredSphereRadius(center, radius);
      }
      return radius;
  },

  updateSquaredSphereRadius : function(center, radius) {
    if (!this._visible) {
      return radius;
    }
    var showRelated = this.showRelated();
    if (showRelated === 'asym') {
      return this._updateSquaredSphereRadiusAsym(center, radius);
    } 
    var assembly = this.structure().assembly(showRelated);
    // in case there is no assembly, fallback to asymmetric unit and bail out.
    if (!assembly) {
      console.error('no assembly', showRelated, 
                    'found. Falling back to asymmetric unit');
      return this._updateSquaredSphereRadiusAsym(center, radius);
    }
    var gens = assembly.generators();
    for (var i = 0; i < gens.length; ++i) {
      var gen = gens[i];
      var affectedVertArrays = this._vertArraysInvolving(gen.chains());
      for (var j = 0; j < gen.matrices().length; ++j) {
        for (var k = 0; k < affectedVertArrays.length; ++k) {
          var transform = gen.matrix(j);
          radius = affectedVertArrays[k].updateSquaredSphereRadius(center, radius);
        }
      }
    }
    return radius;
  },

  draw : function(cam, shaderCatalog, style, pass) {

    if (!this._visible) {
      return;
    }

    var shader = this.shaderForStyleAndPass(shaderCatalog, style, pass);

    if (!shader) {
      return;
    }
    var showRelated = this.showRelated();
    if (showRelated === 'asym') {
      return this._drawVertArrays(cam, shader, this.vertArrays(), null);
    } 

    var assembly = this.structure().assembly(showRelated);
    // in case there is no assembly, fallback to asymmetric unit and bail out.
    if (!assembly) {
      console.error('no assembly', showRelated, 
                    'found. Falling back to asymmetric unit');
      return this._drawVertArrays(cam, shader, this.vertArrays(), null);
    }
    return this._drawSymmetryRelated(cam, shader, assembly);
  },

  colorBy : function(colorFunc, view) {
    console.time('BaseGeom.colorBy');
    this._ready = false;
    view = view || this.structure();
    for (var i = 0; i < this._vertAssocs.length; ++i) {
      this._vertAssocs[i].recolor(colorFunc, view);
    }
    console.timeEnd('BaseGeom.colorBy');
  },

  setOpacity : function(val, view) {
    console.time('BaseGeom.setOpacity');
    this._ready = false;
    view = view || this.structure();
    for (var i = 0; i < this._vertAssocs.length; ++i) {
      this._vertAssocs[i].setOpacity(val, view);
    }
    console.timeEnd('BaseGeom.setOpacity');
  }
});

// Holds geometrical data for objects rendered as lines. For each vertex,
// the color and position is stored in an interleaved format.
function LineGeom(gl, float32Allocator) {
  BaseGeom.call(this, gl);
  this._vertArrays = [];
  this._float32Allocator = float32Allocator;
  this._vertAssocs = [];
  this._lineWidth = 1.0;
}

derive(LineGeom, BaseGeom, {


  addChainVertArray : function(chain, numVerts) {
    var va = new LineChainData(chain.name(), this._gl, numVerts, 
                              this._float32Allocator);
    this._vertArrays.push(va);
    return va;
  },


  setLineWidth : function(width) {
    this._lineWidth = width;
  },

  vertArrays : function() {
    return this._vertArrays;
  },

  shaderForStyleAndPass :
      function(shaderCatalog, style, pass) {
    if (pass === 'outline') {
      return null;
    }
    if (pass === 'select') {
      return shaderCatalog.select;
    }
    return shaderCatalog.lines;
  },

  destroy : function() {
    BaseGeom.prototype.destroy.call(this);
    for (var i = 0; i < this._vertArrays.length; ++i) {
      this._vertArrays[i].destroy();
    }
    this._vertArrays = [];
  },

  _drawVertArrays : function(cam, shader, vertArrays, 
                                                additionalTransforms) {
    this._gl.lineWidth(this._lineWidth * cam.upsamplingFactor());
    var i;
    if (additionalTransforms) {
      for (i = 0; i < vertArrays.length; ++i) {
        vertArrays[i].drawSymmetryRelated(cam, shader, additionalTransforms);
      }
    } else {
      this._gl.uniform1i(shader.symId, 255);
      cam.bind(shader);
      for (i = 0; i < vertArrays.length; ++i) {
        vertArrays[i].bind(shader);
        vertArrays[i].draw();
        vertArrays[i].releaseAttribs(shader);
      }
    }
  },

  vertArray : function() { return this._va; }
});



// an (indexed) mesh geometry container
// ------------------------------------------------------------------------
//
// stores the vertex data in interleaved format. not doing so has severe
// performance penalties in WebGL, and severe means orders of magnitude
// slower than using an interleaved array.
//
// the vertex data is stored in the following format;
//
// Px Py Pz Nx Ny Nz Cr Cg Cb Ca Id
//
// , where P is the position, N the normal and C the color information
// of the vertex.
// 
// Uint16 index buffer limit
// -----------------------------------------------------------------------
//
// In WebGL, index arrays are restricted to uint16. The largest possible
// index value is smaller than the number of vertices required to display 
// larger molecules. To work around this, MeshGeom allows to split the
// render geometry across multiple indexed vertex arrays. 
function MeshGeom(gl, float32Allocator, uint16Allocator) {
  BaseGeom.call(this, gl);
  this._indexedVertArrays = [ ];
  this._float32Allocator = float32Allocator;
  this._uint16Allocator = uint16Allocator;
  this._remainingVerts = null;
  this._remainingIndices = null;
}

derive(MeshGeom, BaseGeom, {
  _boundedVertArraySize : function(size) {
    return Math.min(65536, size);
  },

  addChainVertArray : function(chain, numVerts, numIndices) {
    this._remainingVerts = numVerts;
    this._remainingIndices = numIndices;
    var newVa = new MeshChainData(chain.name(), this._gl, 
                                  this._boundedVertArraySize(numVerts), 
                                  numIndices,
                                  this._float32Allocator, 
                                  this._uint16Allocator);
    this._indexedVertArrays.push(newVa);
    return newVa;
  },

  addVertArray : function(numVerts, numIndices) {
    this._remainingVerts = numVerts;
    this._remainingIndices = numIndices;
    var newVa = new IndexedVertexArray(
      this._gl, this._boundedVertArraySize(numVerts), numIndices,
      this._float32Allocator, this._uint16Allocator);

    this._indexedVertArrays.push(newVa);
    return newVa;
  },

  vertArrayWithSpaceFor : function(numVerts) {
    var currentVa = this._indexedVertArrays[this._indexedVertArrays.length - 1];
    var remaining = currentVa.maxVerts() - currentVa.numVerts();
    if (remaining >= numVerts) {
      return currentVa;
    }
    this._remainingVerts = this._remainingVerts - currentVa.numVerts();
    this._remainingIndices = this._remainingIndices - currentVa.numIndices();
    numVerts = this._boundedVertArraySize(this._remainingVerts);
    var newVa = null;
    if (currentVa instanceof MeshChainData) {
      newVa = new MeshChainData(currentVa.chain(), this._gl, numVerts, 
                                this._remainingIndices,
                                this._float32Allocator, 
                                this._uint16Allocator);
    } else {
      newVa = new IndexedVertexArray(this._gl, numVerts, this._remainingIndices,
        this._float32Allocator, this._uint16Allocator);
    } 
    this._indexedVertArrays.push(newVa);
    return newVa;
  },



  vertArray : function(index) {
    return this._indexedVertArrays[index];
  },

  destroy : function() {
    BaseGeom.prototype.destroy.call(this);
    for (var i = 0; i < this._indexedVertArrays.length; ++i) {
      this._indexedVertArrays[i].destroy();
    }
    this._indexedVertArrays = [];
  },

  numVerts : function() {
    return this._indexedVertArrays[0].numVerts();
  },

  shaderForStyleAndPass :
      function(shaderCatalog, style, pass) {
    if (pass === 'outline') {
      return shaderCatalog.outline;
    }
    if (pass === 'select') {
      return shaderCatalog.select;
    }
    var shader = shaderCatalog[style];
    return shader !== undefined ? shader : null;
  },

  _drawVertArrays : function(cam, shader, indexedVertArrays, 
                                                additionalTransforms) {
    var i;
    if (additionalTransforms) {
      for (i = 0; i < indexedVertArrays.length; ++i) {
        indexedVertArrays[i].drawSymmetryRelated(cam, shader, additionalTransforms);
      }
    } else {
      cam.bind(shader);
      this._gl.uniform1i(shader.symId, 255);
      for (i = 0; i < indexedVertArrays.length; ++i) {
        indexedVertArrays[i].bind(shader);
        indexedVertArrays[i].draw();
        indexedVertArrays[i].releaseAttribs(shader);
      }
    }
  },

  vertArrays : function() {
    return this._indexedVertArrays;
  },

  addVertex : function(pos, normal, color, objId) {
    var va = this._indexedVertArrays[0];
    va.addVertex(pos, normal, color, objId);
  },

  addTriangle : function(idx1, idx2, idx3) {
    var va = this._indexedVertArrays[0];
    va.addTriangle(idx1, idx2, idx3);
  },

});

function TextLabel(gl, canvas, context, pos, text, options) {
  SceneNode.call(this, gl);
  var opts = options || {};
  this._options = {};
  this._options.fillStyle = opts.fillStyle || '#000';
  this._options.backgroundAlpha = opts.backgroundAlpha || 0.0;
  this._options.fontSize = opts.fontSize || 24;
  this._options.font = opts.font || 'Verdana';
  this._options.fontStyle = opts.fontStyle || 'normal';
  this._options.fontColor = opts.fontColor || '#000';
  this._order = 100;
  this._pos = pos;
  this._interleavedBuffer = this._gl.createBuffer();
  this._interleavedData = new Float32Array(5 * 6);

  this._prepareText(canvas, context, text);

  var halfWidth = 0.5;
  var halfHeight = 0.5;
  this._interleavedData[0] = pos[0];
  this._interleavedData[1] = pos[1];
  this._interleavedData[2] = pos[2];
  this._interleavedData[3] = -halfWidth;
  this._interleavedData[4] = -halfHeight;

  this._interleavedData[5] = pos[0];
  this._interleavedData[6] = pos[1];
  this._interleavedData[7] = pos[2];
  this._interleavedData[8] = halfWidth;
  this._interleavedData[9] = halfHeight;

  this._interleavedData[10] = pos[0];
  this._interleavedData[11] = pos[1];
  this._interleavedData[12] = pos[2];
  this._interleavedData[13] = halfWidth;
  this._interleavedData[14] = -halfHeight;

  this._interleavedData[15] = pos[0];
  this._interleavedData[16] = pos[1];
  this._interleavedData[17] = pos[2];
  this._interleavedData[18] = -halfWidth;
  this._interleavedData[19] = -halfHeight;

  this._interleavedData[20] = pos[0];
  this._interleavedData[21] = pos[1];
  this._interleavedData[22] = pos[2];
  this._interleavedData[23] = -halfWidth;
  this._interleavedData[24] = halfHeight;

  this._interleavedData[25] = pos[0];
  this._interleavedData[26] = pos[1];
  this._interleavedData[27] = pos[2];
  this._interleavedData[28] = halfWidth;
  this._interleavedData[29] = halfHeight;
}

function smallestPowerOfTwo(size) {
  var s = 1;
  while (s < size) {
    s *= 2;
  }
  return s;
}
derive(TextLabel, SceneNode, {
  updateProjectionIntervals : function() {
    // text labels don't affect the projection interval. Don't do anything.
  },

  updateSquaredSphereRadius : function(center, radius) { 
    // text labels don't affect the bounding spheres. 
    return radius;
  },


  _setupTextParameters : function(ctx) {
    ctx.fillStyle = this._options.fontColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = this._options.fontStyle + ' ' + 
               this._options.fontSize + 'px '+
               this._options.font;
  },

  _prepareText : function(canvas, ctx, text) {
    this._setupTextParameters(ctx);
    var estimatedWidth = ctx.measureText(text).width;
    var estimatedHeight = 24;
    canvas.width = smallestPowerOfTwo(estimatedWidth);
    canvas.height = smallestPowerOfTwo(estimatedHeight);
    ctx.fillStyle = this._options.fillStyle;
    ctx.globalAlpha = this._options.backgroundAlpha;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this._setupTextParameters(ctx);
    ctx.globalAlpha = 1.0;
    ctx.lineWidth = 0.5;
    ctx.lineStyle = 'none';
    ctx.fillText(text, 0, canvas.height);
    ctx.strokeText(text, 0, canvas.height);
    /*
    // use the following code for testing purposes. for optimal visual
    // results, the pixels of the canvas must match one to one to pixels
    // in the 3D scene.
    ctx.fillStyle='black';
    for (var i = 0; i < canvas.width; i+=2) {
      for (var j = 0; j < canvas.height; j+=2) {
        ctx.fillRect(i + j%2, j, 1, 1);
      }
    }
    */
    this._texture = this._gl.createTexture();
    this._textureFromCanvas(this._texture, canvas);
    // these two variables give us the use portion of the canvas.
    this._xScale = estimatedWidth / canvas.width;
    this._yScale = estimatedHeight / canvas.height;
    this._width = estimatedWidth;
    this._height = estimatedHeight;
  },

  _textureFromCanvas : function(targetTexture, srcCanvas) {
    var gl = this._gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, targetTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, 
                  gl.UNSIGNED_BYTE, srcCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
  },

  bind : function() {
    var gl = this._gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._interleavedBuffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._texture);
    if (this._ready) {
      return;
    }
    gl.bufferData(gl.ARRAY_BUFFER, this._interleavedData, gl.STATIC_DRAW);
    this._ready = true;
  },

  draw : function(cam, shaderCatalog, style, pass) {
    if (!this._visible) {
      return;
    }

    if (pass !== 'normal') {
      return;
    }
    var shader = shaderCatalog.text;
    cam.bind(shader);
    this.bind();
    var gl = this._gl;
    var factor = cam.upsamplingFactor();
    gl.uniform1f(gl.getUniformLocation(shader, 'xScale'), this._xScale);
    gl.uniform1f(gl.getUniformLocation(shader, 'yScale'), this._yScale);
    gl.uniform1f(gl.getUniformLocation(shader, 'width'),
                 factor * 2.0*this._width/cam.viewportWidth());
    gl.uniform1f(gl.getUniformLocation(shader, 'height'),
                 factor * 2.0*this._height/cam.viewportHeight());
    gl.uniform1i(gl.getUniformLocation(shader, 'sampler'), 0);
    var vertAttrib = gl.getAttribLocation(shader, 'attrCenter');
    gl.enableVertexAttribArray(vertAttrib);
    gl.vertexAttribPointer(vertAttrib, 3, gl.FLOAT, false, 5 * 4, 0 * 4);
    var texAttrib = gl.getAttribLocation(shader, 'attrCorner');
    gl.vertexAttribPointer(texAttrib, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
    gl.enableVertexAttribArray(texAttrib);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(vertAttrib);
    gl.disableVertexAttribArray(texAttrib);
    gl.disable(gl.BLEND);
  }
});

// A continous range of object identifiers.
function ContinuousIdRange(pool, start, end) {
  this._pool = pool;
  this._start = start;
  this._next = start;
  this._end = end;
}

ContinuousIdRange.prototype = {
  nextId : function(obj) {
    var id = this._next;
    this._next++;
    this._pool._objects[id] = obj;
    return id;
  },
  recycle : function() {
    this._pool.recycle(this);
  },
  length : function() {
    return this._end - this._start;
  }
};

function UniqueObjectIdPool() {
  this._objects = {};
  this._unusedRangeStart = 0;
  this._free = [];
}

UniqueObjectIdPool.prototype = {
  getContinuousRange : function(num) {
    // FIXME: keep the "free" list sorted, so we can binary search it
    // for a good match
    var bestIndex = -1;
    var bestLength = null;
    for (var i = 0; i < this._free.length; ++i) {
      var free = this._free[i];
      var length = free.length();
      if (length >= num && (bestLength === null || length < bestLength)) {
        bestLength = length;
        bestIndex = i;
      }
    }
    if (bestIndex !== -1) {
      var result = this._free[bestIndex];
      this._free.splice(bestIndex, 1);
      return result;
    }
    var start = this._unusedRangeStart;
    var end = start + num;
    if (end > 65536) {
      console.log('not enough free object ids.');
      return null;
    }
    this._unusedRangeStart = end;
    return new ContinuousIdRange(this, start, end);
  },
  recycle : function(range) {
    for (var i = range._start; i < range._next; ++i) {
      delete this._objects[i];
    }
    range._next = range._start;
    this._free.push(range);
  },
  objectForId : function(id) {
    return this._objects[id];
  }
};

function OrientedBoundingBox(gl, center, halfExtents, 
                             float32Allocator, uint16Allocator) {
  LineGeom.call(this, gl, 24, float32Allocator, uint16Allocator);
  var red = rgb.fromValues(1.0, 0.0, 0.0);
  var green = rgb.fromValues(0.0, 1.0, 0.0);
  var blue = rgb.fromValues(0.0, 0.0, 1.0);
  var tf = mat3.create();
  tf[0] = halfExtents[0][0];
  tf[1] = halfExtents[0][1];
  tf[2] = halfExtents[0][2];

  tf[3] = halfExtents[1][0];
  tf[4] = halfExtents[1][1];
  tf[5] = halfExtents[1][2];

  tf[6] = halfExtents[2][0];
  tf[7] = halfExtents[2][1];
  tf[8] = halfExtents[2][2];
  var a = vec3.create(), b = vec3.create();
  this.addLine(
      vec3.add(a, center, vec3.transformMat3(a, [ -1, -1, -1 ], tf)), red,
      vec3.add(b, center, vec3.transformMat3(b, [ 1, -1, -1 ], tf)), red, -1);

  this.addLine(
      vec3.add(a, center, vec3.transformMat3(a, [ 1, -1, -1 ], tf)), green,
      vec3.add(b, center, vec3.transformMat3(b, [ 1, 1, -1 ], tf)), green, -1);
  this.addLine(
      vec3.add(a, center, vec3.transformMat3(a, [ 1, 1, -1 ], tf)), red,
      vec3.add(b, center, vec3.transformMat3(b, [ -1, 1, -1 ], tf)), red, -1);
  this.addLine(vec3.add(a, center, vec3.transformMat3(a, [ -1, 1, -1 ], tf)),
               green,
               vec3.add(b, center, vec3.transformMat3(b, [ -1, -1, -1 ], tf)),
               green, -1);

  this.addLine(
      vec3.add(a, center, vec3.transformMat3(a, [ -1, -1, 1 ], tf)), red,
      vec3.add(b, center, vec3.transformMat3(b, [ 1, -1, 1 ], tf)), red, -1);
  this.addLine(
      vec3.add(a, center, vec3.transformMat3(a, [ 1, -1, 1 ], tf)), green,
      vec3.add(b, center, vec3.transformMat3(b, [ 1, 1, 1 ], tf)), green, -1);
  this.addLine(
      vec3.add(a, center, vec3.transformMat3(a, [ 1, 1, 1 ], tf)), red,
      vec3.add(b, center, vec3.transformMat3(b, [ -1, 1, 1 ], tf)), red, -1);
  this.addLine(
      vec3.add(a, center, vec3.transformMat3(a, [ -1, 1, 1 ], tf)), green,
      vec3.add(b, center, vec3.transformMat3(b, [ -1, -1, 1 ], tf)), green, -1);

  this.addLine(
      vec3.add(a, center, vec3.transformMat3(a, [ -1, -1, -1 ], tf)), blue,
      vec3.add(b, center, vec3.transformMat3(b, [ -1, -1, 1 ], tf)), blue, -1);
  this.addLine(
      vec3.add(a, center, vec3.transformMat3(a, [ 1, -1, -1 ], tf)), blue,
      vec3.add(b, center, vec3.transformMat3(b, [ 1, -1, 1 ], tf)), blue, -1);
  this.addLine(
      vec3.add(a, center, vec3.transformMat3(a, [ 1, 1, -1 ], tf)), blue,
      vec3.add(b, center, vec3.transformMat3(b, [ 1, 1, 1 ], tf)), blue, -1);
  this.addLine(
      vec3.add(a, center, vec3.transformMat3(a, [ -1, 1, -1 ], tf)), blue,
      vec3.add(b, center, vec3.transformMat3(b, [ -1, 1, 1 ], tf)), blue, -1);
}

derive(OrientedBoundingBox, LineGeom, {
  // don't do anything
  updateProjectionIntervals : function() {}
});

exports.SceneNode = SceneNode;
exports.OrientedBoundingBox = OrientedBoundingBox;
exports.AtomVertexAssoc = AtomVertexAssoc;
exports.TraceVertexAssoc = TraceVertexAssoc;
exports.MeshGeom = MeshGeom;
exports.LineGeom = LineGeom;
exports.TextLabel = TextLabel;
exports.UniqueObjectIdPool = UniqueObjectIdPool;
exports.Range = Range;
})(this);

