/***********************************************************************

  A JavaScript tokenizer / parser / beautifier / compressor.
  https://github.com/mishoo/UglifyJS

  -------------------------------- (C) ---------------------------------

                           Author: Mihai Bazon
                         <mihai.bazon@gmail.com>
                       http://mihai.bazon.net/blog

  Distributed under the BSD license:

    Copyright 2012 (c) Mihai Bazon <mihai.bazon@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:

        * Redistributions of source code must retain the above
          copyright notice, this list of conditions and the following
          disclaimer.

        * Redistributions in binary form must reproduce the above
          copyright notice, this list of conditions and the following
          disclaimer in the documentation and/or other materials
          provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
    EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
    PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
    OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
    PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
    PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
    TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
    THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
    SUCH DAMAGE.

 ***********************************************************************/

"use strict";

function characters(str) {
    return str.split("");
}

function member(name, array) {
    return array.indexOf(name) >= 0;
}

function find_if(func, array) {
    for (var i = array.length; --i >= 0;) if (func(array[i])) return array[i];
}

function configure_error_stack(fn) {
    Object.defineProperty(fn.prototype, "stack", {
        get: function() {
            var err = new Error(this.message);
            err.name = this.name;
            try {
                throw err;
            } catch (e) {
                return e.stack;
            }
        }
    });
}

function DefaultsError(msg, defs) {
    this.message = msg;
    this.defs = defs;
}
DefaultsError.prototype = Object.create(Error.prototype);
DefaultsError.prototype.constructor = DefaultsError;
DefaultsError.prototype.name = "DefaultsError";
configure_error_stack(DefaultsError);

function defaults(args, defs, croak) {
    if (croak) for (var i in args) {
        if (HOP(args, i) && !HOP(defs, i)) throw new DefaultsError("`" + i + "` is not a supported option", defs);
    }
    for (var i in args) {
        if (HOP(args, i)) defs[i] = args[i];
    }
    return defs;
}

function noop() {}
function return_false() { return false; }
function return_true() { return true; }
function return_this() { return this; }
function return_null() { return null; }

var List = (function() {
    function List(a, f) {
        var ret = [];
        for (var i = 0; i < a.length; i++) {
            var val = f(a[i], i);
            if (val === skip) continue;
            if (val instanceof Splice) {
                ret.push.apply(ret, val.v);
            } else {
                ret.push(val);
            }
        }
        return ret;
    }
    List.is_op = function(val) {
        return val === skip || val instanceof Splice;
    };
    List.splice = function(val) {
        return new Splice(val);
    };
    var skip = List.skip = {};
    function Splice(val) {
        this.v = val;
    }
    return List;
})();

function push_uniq(array, el) {
    if (array.indexOf(el) < 0) return array.push(el);
}

function string_template(text, props) {
    return text.replace(/\{([^{}]+)\}/g, function(str, p) {
        var value = p == "this" ? props : props[p];
        if (value instanceof AST_Node) return value.print_to_string();
        if (value instanceof AST_Token) return value.file + ":" + value.line + "," + value.col;
        return value;
    });
}

function remove(array, el) {
    var index = array.indexOf(el);
    if (index >= 0) array.splice(index, 1);
}

function makePredicate(words) {
    if (!Array.isArray(words)) words = words.split(" ");
    var map = Object.create(null);
    words.forEach(function(word) {
        map[word] = true;
    });
    return map;
}

function all(array, predicate) {
    for (var i = array.length; --i >= 0;)
        if (!predicate(array[i], i))
            return false;
    return true;
}

function Dictionary() {
    this.values = Object.create(null);
}
Dictionary.prototype = {
    set: function(key, val) {
        if (key == "__proto__") {
            this.proto_value = val;
        } else {
            this.values[key] = val;
        }
        return this;
    },
    add: function(key, val) {
        var list = this.get(key);
        if (list) {
            list.push(val);
        } else {
            this.set(key, [ val ]);
        }
        return this;
    },
    get: function(key) {
        return key == "__proto__" ? this.proto_value : this.values[key];
    },
    del: function(key) {
        if (key == "__proto__") {
            delete this.proto_value;
        } else {
            delete this.values[key];
        }
        return this;
    },
    has: function(key) {
        return key == "__proto__" ? "proto_value" in this : key in this.values;
    },
    all: function(predicate) {
        for (var i in this.values)
            if (!predicate(this.values[i], i)) return false;
        if ("proto_value" in this && !predicate(this.proto_value, "__proto__")) return false;
        return true;
    },
    each: function(f) {
        for (var i in this.values)
            f(this.values[i], i);
        if ("proto_value" in this) f(this.proto_value, "__proto__");
    },
    size: function() {
        return Object.keys(this.values).length + ("proto_value" in this);
    },
    map: function(f) {
        var ret = [];
        for (var i in this.values)
            ret.push(f(this.values[i], i));
        if ("proto_value" in this) ret.push(f(this.proto_value, "__proto__"));
        return ret;
    },
    clone: function() {
        var ret = new Dictionary();
        this.each(function(value, i) {
            ret.set(i, value);
        });
        return ret;
    },
    toObject: function() {
        var obj = {};
        this.each(function(value, i) {
            obj["$" + i] = value;
        });
        return obj;
    },
};
Dictionary.fromObject = function(obj) {
    var dict = new Dictionary();
    for (var i in obj)
        if (HOP(obj, i)) dict.set(i.slice(1), obj[i]);
    return dict;
};

function HOP(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
}

// return true if the node at the top of the stack (that means the
// innermost node in the current output) is lexically the first in
// a statement.
function first_in_statement(stack, arrow, export_default) {
    var node = stack.parent(-1);
    for (var i = 0, p; p = stack.parent(i++); node = p) {
        if (is_arrow(p)) {
            return arrow && p.value === node;
        } else if (p instanceof AST_Binary) {
            if (p.left === node) continue;
        } else if (p.TYPE == "Call") {
            if (p.expression === node) continue;
        } else if (p instanceof AST_Conditional) {
            if (p.condition === node) continue;
        } else if (p instanceof AST_ExportDefault) {
            return export_default;
        } else if (p instanceof AST_PropAccess) {
            if (p.expression === node) continue;
        } else if (p instanceof AST_Sequence) {
            if (p.expressions[0] === node) continue;
        } else if (p instanceof AST_SimpleStatement) {
            return true;
        } else if (p instanceof AST_Template) {
            if (p.tag === node) continue;
        } else if (p instanceof AST_UnaryPostfix) {
            if (p.expression === node) continue;
        }
        return false;
    }
}

function DEF_BITPROPS(ctor, props) {
    if (props.length > 31) throw new Error("Too many properties: " + props.length + "\n" + props.join(", "));
    props.forEach(function(name, pos) {
        var mask = 1 << pos;
        Object.defineProperty(ctor.prototype, name, {
            get: function() {
                return !!(this._bits & mask);
            },
            set: function(val) {
                if (val)
                    this._bits |= mask;
                else
                    this._bits &= ~mask;
            },
        });
    });
}


/***********************************************************************

  A JavaScript tokenizer / parser / beautifier / compressor.
  https://github.com/mishoo/UglifyJS

  -------------------------------- (C) ---------------------------------

                           Author: Mihai Bazon
                         <mihai.bazon@gmail.com>
                       http://mihai.bazon.net/blog

  Distributed under the BSD license:

    Copyright 2012 (c) Mihai Bazon <mihai.bazon@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:

        * Redistributions of source code must retain the above
          copyright notice, this list of conditions and the following
          disclaimer.

        * Redistributions in binary form must reproduce the above
          copyright notice, this list of conditions and the following
          disclaimer in the documentation and/or other materials
          provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
    EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
    PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
    OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
    PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
    PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
    TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
    THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
    SUCH DAMAGE.

 ***********************************************************************/

"use strict";

function DEFNODE(type, props, methods, base) {
    if (typeof base === "undefined") base = AST_Node;
    props = props ? props.split(/\s+/) : [];
    var self_props = props;
    if (base && base.PROPS) props = props.concat(base.PROPS);
    var code = [
        "return function AST_", type, "(props){",
        // not essential, but speeds up compress by a few percent
        "this._bits=0;",
        "if(props){",
    ];
    props.forEach(function(prop) {
        code.push("this.", prop, "=props.", prop, ";");
    });
    code.push("}");
    var proto = Object.create(base && base.prototype);
    if (methods.initialize || proto.initialize) code.push("this.initialize();");
    code.push("};");
    var ctor = new Function(code.join(""))();
    ctor.prototype = proto;
    ctor.prototype.CTOR = ctor;
    ctor.prototype.TYPE = ctor.TYPE = type;
    if (base) {
        ctor.BASE = base;
        base.SUBCLASSES.push(ctor);
    }
    ctor.DEFMETHOD = function(name, method) {
        this.prototype[name] = method;
    };
    ctor.PROPS = props;
    ctor.SELF_PROPS = self_props;
    ctor.SUBCLASSES = [];
    for (var name in methods) if (HOP(methods, name)) {
        if (/^\$/.test(name)) {
            ctor[name.substr(1)] = methods[name];
        } else {
            ctor.DEFMETHOD(name, methods[name]);
        }
    }
    if (typeof exports !== "undefined") exports["AST_" + type] = ctor;
    return ctor;
}

var AST_Token = DEFNODE("Token", "type value line col pos endline endcol endpos nlb comments_before comments_after file raw", {
}, null);

var AST_Node = DEFNODE("Node", "start end", {
    _clone: function(deep) {
        if (deep) {
            var self = this.clone();
            return self.transform(new TreeTransformer(function(node) {
                if (node !== self) {
                    return node.clone(true);
                }
            }));
        }
        return new this.CTOR(this);
    },
    clone: function(deep) {
        return this._clone(deep);
    },
    $documentation: "Base class of all AST nodes",
    $propdoc: {
        start: "[AST_Token] The first token of this node",
        end: "[AST_Token] The last token of this node"
    },
    equals: function(node) {
        return this.TYPE == node.TYPE && this._equals(node);
    },
    walk: function(visitor) {
        visitor.visit(this);
    },
    _validate: function() {
        if (this.TYPE == "Node") throw new Error("should not instantiate AST_Node");
    },
    validate: function() {
        var ctor = this.CTOR;
        do {
            ctor.prototype._validate.call(this);
        } while (ctor = ctor.BASE);
    },
    validate_ast: function() {
        var marker = {};
        this.walk(new TreeWalker(function(node) {
            if (node.validate_visited === marker) {
                throw new Error(string_template("cannot reuse AST_{TYPE} from [{start}]", node));
            }
            node.validate_visited = marker;
        }));
    },
}, null);

DEF_BITPROPS(AST_Node, [
    // AST_Node
    "_optimized",
    "_squeezed",
    // AST_Call
    "call_only",
    // AST_Lambda
    "collapse_scanning",
    // AST_SymbolRef
    "defined",
    "evaluating",
    "falsy",
    // AST_SymbolRef
    "in_arg",
    // AST_Return
    "in_bool",
    // AST_SymbolRef
    "is_undefined",
    // AST_LambdaExpression
    // AST_LambdaDefinition
    "inlined",
    // AST_Lambda
    "length_read",
    // AST_Yield
    "nested",
    // AST_Lambda
    "new",
    // AST_Call
    // AST_PropAccess
    "optional",
    // AST_ClassProperty
    "private",
    // AST_Call
    "pure",
    // AST_Assign
    "redundant",
    // AST_Node
    "single_use",
    // AST_ClassProperty
    "static",
    // AST_Call
    // AST_PropAccess
    "terminal",
    "truthy",
    // AST_Scope
    "uses_eval",
    // AST_Scope
    "uses_with",
]);

(AST_Node.log_function = function(fn, verbose) {
    if (typeof fn != "function") {
        AST_Node.info = AST_Node.warn = noop;
        return;
    }
    var printed = Object.create(null);
    AST_Node.info = verbose ? function(text, props) {
        log("INFO: " + string_template(text, props));
    } : noop;
    AST_Node.warn = function(text, props) {
        log("WARN: " + string_template(text, props));
    };

    function log(msg) {
        if (printed[msg]) return;
        printed[msg] = true;
        fn(msg);
    }
})();

var restore_transforms = [];
AST_Node.enable_validation = function() {
    AST_Node.disable_validation();
    (function validate_transform(ctor) {
        ctor.SUBCLASSES.forEach(validate_transform);
        if (!HOP(ctor.prototype, "transform")) return;
        var transform = ctor.prototype.transform;
        ctor.prototype.transform = function(tw, in_list) {
            var node = transform.call(this, tw, in_list);
            if (node instanceof AST_Node) {
                node.validate();
            } else if (!(node === null || in_list && List.is_op(node))) {
                throw new Error("invalid transformed value: " + node);
            }
            return node;
        };
        restore_transforms.push(function() {
            ctor.prototype.transform = transform;
        });
    })(this);
};

AST_Node.disable_validation = function() {
    var restore;
    while (restore = restore_transforms.pop()) restore();
};

function all_equals(k, l) {
    return k.length == l.length && all(k, function(m, i) {
        return m.equals(l[i]);
    });
}

function list_equals(s, t) {
    return s.length == t.length && all(s, function(u, i) {
        return u == t[i];
    });
}

function prop_equals(u, v) {
    if (u === v) return true;
    if (u == null) return v == null;
    return u instanceof AST_Node && v instanceof AST_Node && u.equals(v);
}

/* -----[ statements ]----- */

var AST_Statement = DEFNODE("Statement", null, {
    $documentation: "Base class of all statements",
    _validate: function() {
        if (this.TYPE == "Statement") throw new Error("should not instantiate AST_Statement");
    },
});

var AST_Debugger = DEFNODE("Debugger", null, {
    $documentation: "Represents a debugger statement",
    _equals: return_true,
}, AST_Statement);

var AST_Directive = DEFNODE("Directive", "quote value", {
    $documentation: "Represents a directive, like \"use strict\";",
    $propdoc: {
        quote: "[string?] the original quote character",
        value: "[string] The value of this directive as a plain string (it's not an AST_String!)",
    },
    _equals: function(node) {
        return this.value == node.value;
    },
    _validate: function() {
        if (this.quote != null) {
            if (typeof this.quote != "string") throw new Error("quote must be string");
            if (!/^["']$/.test(this.quote)) throw new Error("invalid quote: " + this.quote);
        }
        if (typeof this.value != "string") throw new Error("value must be string");
    },
}, AST_Statement);

var AST_EmptyStatement = DEFNODE("EmptyStatement", null, {
    $documentation: "The empty statement (empty block or simply a semicolon)",
    _equals: return_true,
}, AST_Statement);

function is_statement(node) {
    return node instanceof AST_Statement
        && !(node instanceof AST_ClassExpression)
        && !(node instanceof AST_LambdaExpression);
}

function validate_expression(value, prop, multiple, allow_spread, allow_hole) {
    multiple = multiple ? "contain" : "be";
    if (!(value instanceof AST_Node)) throw new Error(prop + " must " + multiple + " AST_Node");
    if (value instanceof AST_DefaultValue) throw new Error(prop + " cannot " + multiple + " AST_DefaultValue");
    if (value instanceof AST_Destructured) throw new Error(prop + " cannot " + multiple + " AST_Destructured");
    if (value instanceof AST_Hole && !allow_hole) throw new Error(prop + " cannot " + multiple + " AST_Hole");
    if (value instanceof AST_Spread && !allow_spread) throw new Error(prop + " cannot " + multiple + " AST_Spread");
    if (is_statement(value)) throw new Error(prop + " cannot " + multiple + " AST_Statement");
    if (value instanceof AST_SymbolDeclaration) {
        throw new Error(prop + " cannot " + multiple + " AST_SymbolDeclaration");
    }
}

function must_be_expression(node, prop) {
    validate_expression(node[prop], prop);
}

var AST_SimpleStatement = DEFNODE("SimpleStatement", "body", {
    $documentation: "A statement consisting of an expression, i.e. a = 1 + 2",
    $propdoc: {
        body: "[AST_Node] an expression node (should not be instanceof AST_Statement)",
    },
    _equals: function(node) {
        return this.body.equals(node.body);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.body.walk(visitor);
        });
    },
    _validate: function() {
        must_be_expression(this, "body");
    },
}, AST_Statement);

var AST_BlockScope = DEFNODE("BlockScope", "_var_names enclosed functions make_def parent_scope variables", {
    $documentation: "Base class for all statements introducing a lexical scope",
    $propdoc: {
        enclosed: "[SymbolDef*/S] a list of all symbol definitions that are accessed from this scope or any inner scopes",
        functions: "[Dictionary/S] like `variables`, but only lists function declarations",
        parent_scope: "[AST_Scope?/S] link to the parent scope",
        variables: "[Dictionary/S] a map of name ---> SymbolDef for all variables/functions defined in this scope",
    },
    clone: function(deep) {
        var node = this._clone(deep);
        if (this.enclosed) node.enclosed = this.enclosed.slice();
        if (this.functions) node.functions = this.functions.clone();
        if (this.variables) node.variables = this.variables.clone();
        return node;
    },
    pinned: function() {
        return this.resolve().pinned();
    },
    resolve: function() {
        return this.parent_scope.resolve();
    },
    _validate: function() {
        if (this.TYPE == "BlockScope") throw new Error("should not instantiate AST_BlockScope");
        if (this.parent_scope == null) return;
        if (!(this.parent_scope instanceof AST_BlockScope)) throw new Error("parent_scope must be AST_BlockScope");
        if (!(this.resolve() instanceof AST_Scope)) throw new Error("must be contained within AST_Scope");
    },
}, AST_Statement);

function walk_body(node, visitor) {
    node.body.forEach(function(node) {
        node.walk(visitor);
    });
}

var AST_Block = DEFNODE("Block", "body", {
    $documentation: "A body of statements (usually braced)",
    $propdoc: {
        body: "[AST_Statement*] an array of statements"
    },
    _equals: function(node) {
        return all_equals(this.body, node.body);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            walk_body(node, visitor);
        });
    },
    _validate: function() {
        if (this.TYPE == "Block") throw new Error("should not instantiate AST_Block");
        this.body.forEach(function(node) {
            if (!is_statement(node)) throw new Error("body must contain AST_Statement");
        });
    },
}, AST_BlockScope);

var AST_BlockStatement = DEFNODE("BlockStatement", null, {
    $documentation: "A block statement",
}, AST_Block);

var AST_StatementWithBody = DEFNODE("StatementWithBody", "body", {
    $documentation: "Base class for all statements that contain one nested body: `For`, `ForIn`, `Do`, `While`, `With`",
    $propdoc: {
        body: "[AST_Statement] the body; this should always be present, even if it's an AST_EmptyStatement"
    },
    _validate: function() {
        if (this.TYPE == "StatementWithBody") throw new Error("should not instantiate AST_StatementWithBody");
        if (!is_statement(this.body)) throw new Error("body must be AST_Statement");
    },
}, AST_BlockScope);

var AST_LabeledStatement = DEFNODE("LabeledStatement", "label", {
    $documentation: "Statement with a label",
    $propdoc: {
        label: "[AST_Label] a label definition"
    },
    _equals: function(node) {
        return this.label.equals(node.label)
            && this.body.equals(node.body);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.label.walk(visitor);
            node.body.walk(visitor);
        });
    },
    clone: function(deep) {
        var node = this._clone(deep);
        if (deep) {
            var label = node.label;
            var def = this.label;
            node.walk(new TreeWalker(function(node) {
                if (node instanceof AST_LoopControl) {
                    if (!node.label || node.label.thedef !== def) return;
                    node.label.thedef = label;
                    label.references.push(node);
                    return true;
                }
                if (node instanceof AST_Scope) return true;
            }));
        }
        return node;
    },
    _validate: function() {
        if (!(this.label instanceof AST_Label)) throw new Error("label must be AST_Label");
    },
}, AST_StatementWithBody);

var AST_IterationStatement = DEFNODE("IterationStatement", null, {
    $documentation: "Internal class.  All loops inherit from it.",
    _validate: function() {
        if (this.TYPE == "IterationStatement") throw new Error("should not instantiate AST_IterationStatement");
    },
}, AST_StatementWithBody);

var AST_DWLoop = DEFNODE("DWLoop", "condition", {
    $documentation: "Base class for do/while statements",
    $propdoc: {
        condition: "[AST_Node] the loop condition.  Should not be instanceof AST_Statement"
    },
    _equals: function(node) {
        return this.body.equals(node.body)
            && this.condition.equals(node.condition);
    },
    _validate: function() {
        if (this.TYPE == "DWLoop") throw new Error("should not instantiate AST_DWLoop");
        must_be_expression(this, "condition");
    },
}, AST_IterationStatement);

var AST_Do = DEFNODE("Do", null, {
    $documentation: "A `do` statement",
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.body.walk(visitor);
            node.condition.walk(visitor);
        });
    },
}, AST_DWLoop);

var AST_While = DEFNODE("While", null, {
    $documentation: "A `while` statement",
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.condition.walk(visitor);
            node.body.walk(visitor);
        });
    },
}, AST_DWLoop);

var AST_For = DEFNODE("For", "init condition step", {
    $documentation: "A `for` statement",
    $propdoc: {
        init: "[AST_Node?] the `for` initialization code, or null if empty",
        condition: "[AST_Node?] the `for` termination clause, or null if empty",
        step: "[AST_Node?] the `for` update clause, or null if empty"
    },
    _equals: function(node) {
        return prop_equals(this.init, node.init)
            && prop_equals(this.condition, node.condition)
            && prop_equals(this.step, node.step)
            && this.body.equals(node.body);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            if (node.init) node.init.walk(visitor);
            if (node.condition) node.condition.walk(visitor);
            if (node.step) node.step.walk(visitor);
            node.body.walk(visitor);
        });
    },
    _validate: function() {
        if (this.init != null) {
            if (!(this.init instanceof AST_Node)) throw new Error("init must be AST_Node");
            if (is_statement(this.init) && !(this.init instanceof AST_Definitions)) {
                throw new Error("init cannot be AST_Statement");
            }
        }
        if (this.condition != null) must_be_expression(this, "condition");
        if (this.step != null) must_be_expression(this, "step");
    },
}, AST_IterationStatement);

var AST_ForEnumeration = DEFNODE("ForEnumeration", "init object", {
    $documentation: "Base class for enumeration loops, i.e. `for ... in`, `for ... of` & `for await ... of`",
    $propdoc: {
        init: "[AST_Node] the assignment target during iteration",
        object: "[AST_Node] the object to iterate over"
    },
    _equals: function(node) {
        return this.init.equals(node.init)
            && this.object.equals(node.object)
            && this.body.equals(node.body);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.init.walk(visitor);
            node.object.walk(visitor);
            node.body.walk(visitor);
        });
    },
    _validate: function() {
        if (this.TYPE == "ForEnumeration") throw new Error("should not instantiate AST_ForEnumeration");
        if (this.init instanceof AST_Definitions) {
            if (this.init.definitions.length != 1) throw new Error("init must have single declaration");
        } else {
            validate_destructured(this.init, function(node) {
                if (!(node instanceof AST_PropAccess || node instanceof AST_SymbolRef)) {
                    throw new Error("init must be assignable: " + node.TYPE);
                }
            });
        }
        must_be_expression(this, "object");
    },
}, AST_IterationStatement);

var AST_ForIn = DEFNODE("ForIn", null, {
    $documentation: "A `for ... in` statement",
}, AST_ForEnumeration);

var AST_ForOf = DEFNODE("ForOf", null, {
    $documentation: "A `for ... of` statement",
}, AST_ForEnumeration);

var AST_ForAwaitOf = DEFNODE("ForAwaitOf", null, {
    $documentation: "A `for await ... of` statement",
}, AST_ForOf);

var AST_With = DEFNODE("With", "expression", {
    $documentation: "A `with` statement",
    $propdoc: {
        expression: "[AST_Node] the `with` expression"
    },
    _equals: function(node) {
        return this.expression.equals(node.expression)
            && this.body.equals(node.body);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.expression.walk(visitor);
            node.body.walk(visitor);
        });
    },
    _validate: function() {
        must_be_expression(this, "expression");
    },
}, AST_StatementWithBody);

/* -----[ scope and functions ]----- */

var AST_Scope = DEFNODE("Scope", "fn_defs may_call_this uses_eval uses_with", {
    $documentation: "Base class for all statements introducing a lambda scope",
    $propdoc: {
        uses_eval: "[boolean/S] tells whether this scope contains a direct call to the global `eval`",
        uses_with: "[boolean/S] tells whether this scope uses the `with` statement",
    },
    pinned: function() {
        return this.uses_eval || this.uses_with;
    },
    resolve: return_this,
    _validate: function() {
        if (this.TYPE == "Scope") throw new Error("should not instantiate AST_Scope");
    },
}, AST_Block);

var AST_Toplevel = DEFNODE("Toplevel", "globals", {
    $documentation: "The toplevel scope",
    $propdoc: {
        globals: "[Dictionary/S] a map of name ---> SymbolDef for all undeclared names",
    },
    wrap: function(name) {
        var body = this.body;
        return parse([
            "(function(exports){'$ORIG';})(typeof ",
            name,
            "=='undefined'?(",
            name,
            "={}):",
            name,
            ");"
        ].join(""), {
            filename: "wrap=" + JSON.stringify(name)
        }).transform(new TreeTransformer(function(node) {
            if (node instanceof AST_Directive && node.value == "$ORIG") {
                return List.splice(body);
            }
        }));
    },
    enclose: function(args_values) {
        if (typeof args_values != "string") args_values = "";
        var index = args_values.indexOf(":");
        if (index < 0) index = args_values.length;
        var body = this.body;
        return parse([
            "(function(",
            args_values.slice(0, index),
            '){"$ORIG"})(',
            args_values.slice(index + 1),
            ")"
        ].join(""), {
            filename: "enclose=" + JSON.stringify(args_values)
        }).transform(new TreeTransformer(function(node) {
            if (node instanceof AST_Directive && node.value == "$ORIG") {
                return List.splice(body);
            }
        }));
    }
}, AST_Scope);

var AST_ClassInitBlock = DEFNODE("ClassInitBlock", null, {
    $documentation: "Value for `class` static initialization blocks",
}, AST_Scope);

var AST_Lambda = DEFNODE("Lambda", "argnames length_read rest safe_ids uses_arguments", {
    $documentation: "Base class for functions",
    $propdoc: {
        argnames: "[(AST_DefaultValue|AST_Destructured|AST_SymbolFunarg)*] array of function arguments and/or destructured literals",
        length_read: "[boolean/S] whether length property of this function is accessed",
        rest: "[(AST_Destructured|AST_SymbolFunarg)?] rest parameter, or null if absent",
        uses_arguments: "[boolean|number/S] whether this function accesses the arguments array",
    },
    each_argname: function(visit) {
        var tw = new TreeWalker(function(node) {
            if (node instanceof AST_DefaultValue) {
                node.name.walk(tw);
                return true;
            }
            if (node instanceof AST_DestructuredKeyVal) {
                node.value.walk(tw);
                return true;
            }
            if (node instanceof AST_SymbolFunarg) visit(node);
        });
        this.argnames.forEach(function(argname) {
            argname.walk(tw);
        });
        if (this.rest) this.rest.walk(tw);
    },
    _equals: function(node) {
        return prop_equals(this.rest, node.rest)
            && prop_equals(this.name, node.name)
            && prop_equals(this.value, node.value)
            && all_equals(this.argnames, node.argnames)
            && all_equals(this.body, node.body);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            if (node.name) node.name.walk(visitor);
            node.argnames.forEach(function(argname) {
                argname.walk(visitor);
            });
            if (node.rest) node.rest.walk(visitor);
            walk_body(node, visitor);
        });
    },
    _validate: function() {
        if (this.TYPE == "Lambda") throw new Error("should not instantiate AST_Lambda");
        this.argnames.forEach(function(node) {
            validate_destructured(node, function(node) {
                if (!(node instanceof AST_SymbolFunarg)) throw new Error("argnames must be AST_SymbolFunarg[]");
            }, true);
        });
        if (this.rest != null) validate_destructured(this.rest, function(node) {
            if (!(node instanceof AST_SymbolFunarg)) throw new Error("rest must be AST_SymbolFunarg");
        });
    },
}, AST_Scope);

var AST_Accessor = DEFNODE("Accessor", null, {
    $documentation: "A getter/setter function",
    _validate: function() {
        if (this.name != null) throw new Error("name must be null");
    },
}, AST_Lambda);

var AST_LambdaExpression = DEFNODE("LambdaExpression", "inlined", {
    $documentation: "Base class for function expressions",
    $propdoc: {
        inlined: "[boolean/S] whether this function has been inlined",
    },
    _validate: function() {
        if (this.TYPE == "LambdaExpression") throw new Error("should not instantiate AST_LambdaExpression");
    },
}, AST_Lambda);

function is_arrow(node) {
    return node instanceof AST_Arrow || node instanceof AST_AsyncArrow;
}

function is_async(node) {
    return node instanceof AST_AsyncArrow
        || node instanceof AST_AsyncDefun
        || node instanceof AST_AsyncFunction
        || node instanceof AST_AsyncGeneratorDefun
        || node instanceof AST_AsyncGeneratorFunction;
}

function is_generator(node) {
    return node instanceof AST_AsyncGeneratorDefun
        || node instanceof AST_AsyncGeneratorFunction
        || node instanceof AST_GeneratorDefun
        || node instanceof AST_GeneratorFunction;
}

function walk_lambda(node, tw) {
    if (is_arrow(node) && node.value) {
        node.value.walk(tw);
    } else {
        walk_body(node, tw);
    }
}

var AST_Arrow = DEFNODE("Arrow", "value", {
    $documentation: "An arrow function expression",
    $propdoc: {
        value: "[AST_Node?] simple return expression, or null if using function body.",
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.argnames.forEach(function(argname) {
                argname.walk(visitor);
            });
            if (node.rest) node.rest.walk(visitor);
            if (node.value) {
                node.value.walk(visitor);
            } else {
                walk_body(node, visitor);
            }
        });
    },
    _validate: function() {
        if (this.name != null) throw new Error("name must be null");
        if (this.uses_arguments) throw new Error("uses_arguments must be false");
        if (this.value != null) {
            must_be_expression(this, "value");
            if (this.body.length) throw new Error("body must be empty if value exists");
        }
    },
}, AST_LambdaExpression);

var AST_AsyncArrow = DEFNODE("AsyncArrow", "value", {
    $documentation: "An asynchronous arrow function expression",
    $propdoc: {
        value: "[AST_Node?] simple return expression, or null if using function body.",
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.argnames.forEach(function(argname) {
                argname.walk(visitor);
            });
            if (node.rest) node.rest.walk(visitor);
            if (node.value) {
                node.value.walk(visitor);
            } else {
                walk_body(node, visitor);
            }
        });
    },
    _validate: function() {
        if (this.name != null) throw new Error("name must be null");
        if (this.uses_arguments) throw new Error("uses_arguments must be false");
        if (this.value != null) {
            must_be_expression(this, "value");
            if (this.body.length) throw new Error("body must be empty if value exists");
        }
    },
}, AST_LambdaExpression);

var AST_AsyncFunction = DEFNODE("AsyncFunction", "name", {
    $documentation: "An asynchronous function expression",
    $propdoc: {
        name: "[AST_SymbolLambda?] the name of this function, or null if not specified",
    },
    _validate: function() {
        if (this.name != null) {
            if (!(this.name instanceof AST_SymbolLambda)) throw new Error("name must be AST_SymbolLambda");
        }
    },
}, AST_LambdaExpression);

var AST_AsyncGeneratorFunction = DEFNODE("AsyncGeneratorFunction", "name", {
    $documentation: "An asynchronous generator function expression",
    $propdoc: {
        name: "[AST_SymbolLambda?] the name of this function, or null if not specified",
    },
    _validate: function() {
        if (this.name != null) {
            if (!(this.name instanceof AST_SymbolLambda)) throw new Error("name must be AST_SymbolLambda");
        }
    },
}, AST_LambdaExpression);

var AST_Function = DEFNODE("Function", "name", {
    $documentation: "A function expression",
    $propdoc: {
        name: "[AST_SymbolLambda?] the name of this function, or null if not specified",
    },
    _validate: function() {
        if (this.name != null) {
            if (!(this.name instanceof AST_SymbolLambda)) throw new Error("name must be AST_SymbolLambda");
        }
    },
}, AST_LambdaExpression);

var AST_GeneratorFunction = DEFNODE("GeneratorFunction", "name", {
    $documentation: "A generator function expression",
    $propdoc: {
        name: "[AST_SymbolLambda?] the name of this function, or null if not specified",
    },
    _validate: function() {
        if (this.name != null) {
            if (!(this.name instanceof AST_SymbolLambda)) throw new Error("name must be AST_SymbolLambda");
        }
    },
}, AST_LambdaExpression);

var AST_LambdaDefinition = DEFNODE("LambdaDefinition", "inlined name", {
    $documentation: "Base class for function definitions",
    $propdoc: {
        inlined: "[boolean/S] whether this function has been inlined",
        name: "[AST_SymbolDefun] the name of this function",
    },
    _validate: function() {
        if (this.TYPE == "LambdaDefinition") throw new Error("should not instantiate AST_LambdaDefinition");
        if (!(this.name instanceof AST_SymbolDefun)) throw new Error("name must be AST_SymbolDefun");
    },
}, AST_Lambda);

var AST_AsyncDefun = DEFNODE("AsyncDefun", null, {
    $documentation: "An asynchronous function definition",
}, AST_LambdaDefinition);

var AST_AsyncGeneratorDefun = DEFNODE("AsyncGeneratorDefun", null, {
    $documentation: "An asynchronous generator function definition",
}, AST_LambdaDefinition);

var AST_Defun = DEFNODE("Defun", null, {
    $documentation: "A function definition",
}, AST_LambdaDefinition);

var AST_GeneratorDefun = DEFNODE("GeneratorDefun", null, {
    $documentation: "A generator function definition",
}, AST_LambdaDefinition);

/* -----[ classes ]----- */

var AST_Class = DEFNODE("Class", "extends name properties", {
    $documentation: "Base class for class literals",
    $propdoc: {
        extends: "[AST_Node?] the super class, or null if not specified",
        properties: "[AST_ClassProperty*] array of class properties",
    },
    _equals: function(node) {
        return prop_equals(this.name, node.name)
            && prop_equals(this.extends, node.extends)
            && all_equals(this.properties, node.properties);
    },
    resolve: function(def_class) {
        return def_class ? this : this.parent_scope.resolve();
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            if (node.name) node.name.walk(visitor);
            if (node.extends) node.extends.walk(visitor);
            node.properties.forEach(function(prop) {
                prop.walk(visitor);
            });
        });
    },
    _validate: function() {
        if (this.TYPE == "Class") throw new Error("should not instantiate AST_Class");
        if (this.extends != null) must_be_expression(this, "extends");
        this.properties.forEach(function(node) {
            if (!(node instanceof AST_ClassProperty)) throw new Error("properties must contain AST_ClassProperty");
        });
    },
}, AST_BlockScope);

var AST_DefClass = DEFNODE("DefClass", null, {
    $documentation: "A class definition",
    $propdoc: {
        name: "[AST_SymbolDefClass] the name of this class",
    },
    _validate: function() {
        if (!(this.name instanceof AST_SymbolDefClass)) throw new Error("name must be AST_SymbolDefClass");
    },
}, AST_Class);

var AST_ClassExpression = DEFNODE("ClassExpression", null, {
    $documentation: "A class expression",
    $propdoc: {
        name: "[AST_SymbolClass?] the name of this class, or null if not specified",
    },
    _validate: function() {
        if (this.name != null) {
            if (!(this.name instanceof AST_SymbolClass)) throw new Error("name must be AST_SymbolClass");
        }
    },
}, AST_Class);

var AST_ClassProperty = DEFNODE("ClassProperty", "key private static value", {
    $documentation: "Base class for `class` properties",
    $propdoc: {
        key: "[string|AST_Node?] property name (AST_Node for computed property, null for initialization block)",
        private: "[boolean] whether this is a private property",
        static: "[boolean] whether this is a static property",
        value: "[AST_Node?] property value (AST_Accessor for getters/setters, AST_LambdaExpression for methods, null if not specified for fields)",
    },
    _equals: function(node) {
        return !this.private == !node.private
            && !this.static == !node.static
            && prop_equals(this.key, node.key)
            && prop_equals(this.value, node.value);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            if (node.key instanceof AST_Node) node.key.walk(visitor);
            if (node.value) node.value.walk(visitor);
        });
    },
    _validate: function() {
        if (this.TYPE == "ClassProperty") throw new Error("should not instantiate AST_ClassProperty");
        if (this instanceof AST_ClassInit) {
            if (this.key != null) throw new Error("key must be null");
        } else if (typeof this.key != "string") {
            if (!(this.key instanceof AST_Node)) throw new Error("key must be string or AST_Node");
            must_be_expression(this, "key");
        }
        if(this.value != null) {
            if (!(this.value instanceof AST_Node)) throw new Error("value must be AST_Node");
        }
    },
});

var AST_ClassField = DEFNODE("ClassField", null, {
    $documentation: "A `class` field",
    _validate: function() {
        if(this.value != null) must_be_expression(this, "value");
    },
}, AST_ClassProperty);

var AST_ClassGetter = DEFNODE("ClassGetter", null, {
    $documentation: "A `class` getter",
    _validate: function() {
        if (!(this.value instanceof AST_Accessor)) throw new Error("value must be AST_Accessor");
    },
}, AST_ClassProperty);

var AST_ClassSetter = DEFNODE("ClassSetter", null, {
    $documentation: "A `class` setter",
    _validate: function() {
        if (!(this.value instanceof AST_Accessor)) throw new Error("value must be AST_Accessor");
    },
}, AST_ClassProperty);

var AST_ClassMethod = DEFNODE("ClassMethod", null, {
    $documentation: "A `class` method",
    _validate: function() {
        if (!(this.value instanceof AST_LambdaExpression)) throw new Error("value must be AST_LambdaExpression");
        if (is_arrow(this.value)) throw new Error("value cannot be AST_Arrow or AST_AsyncArrow");
        if (this.value.name != null) throw new Error("name of class method's lambda must be null");
    },
}, AST_ClassProperty);

var AST_ClassInit = DEFNODE("ClassInit", null, {
    $documentation: "A `class` static initialization block",
    _validate: function() {
        if (!this.static) throw new Error("static must be true");
        if (!(this.value instanceof AST_ClassInitBlock)) throw new Error("value must be AST_ClassInitBlock");
    },
    initialize: function() {
        this.static = true;
    },
}, AST_ClassProperty);

/* -----[ JUMPS ]----- */

var AST_Jump = DEFNODE("Jump", null, {
    $documentation: "Base class for “jumps” (for now that's `return`, `throw`, `break` and `continue`)",
    _validate: function() {
        if (this.TYPE == "Jump") throw new Error("should not instantiate AST_Jump");
    },
}, AST_Statement);

var AST_Exit = DEFNODE("Exit", "value", {
    $documentation: "Base class for “exits” (`return` and `throw`)",
    $propdoc: {
        value: "[AST_Node?] the value returned or thrown by this statement; could be null for AST_Return"
    },
    _equals: function(node) {
        return prop_equals(this.value, node.value);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            if (node.value) node.value.walk(visitor);
        });
    },
    _validate: function() {
        if (this.TYPE == "Exit") throw new Error("should not instantiate AST_Exit");
    },
}, AST_Jump);

var AST_Return = DEFNODE("Return", null, {
    $documentation: "A `return` statement",
    _validate: function() {
        if (this.value != null) must_be_expression(this, "value");
    },
}, AST_Exit);

var AST_Throw = DEFNODE("Throw", null, {
    $documentation: "A `throw` statement",
    _validate: function() {
        must_be_expression(this, "value");
    },
}, AST_Exit);

var AST_LoopControl = DEFNODE("LoopControl", "label", {
    $documentation: "Base class for loop control statements (`break` and `continue`)",
    $propdoc: {
        label: "[AST_LabelRef?] the label, or null if none",
    },
    _equals: function(node) {
        return prop_equals(this.label, node.label);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            if (node.label) node.label.walk(visitor);
        });
    },
    _validate: function() {
        if (this.TYPE == "LoopControl") throw new Error("should not instantiate AST_LoopControl");
        if (this.label != null) {
            if (!(this.label instanceof AST_LabelRef)) throw new Error("label must be AST_LabelRef");
        }
    },
}, AST_Jump);

var AST_Break = DEFNODE("Break", null, {
    $documentation: "A `break` statement"
}, AST_LoopControl);

var AST_Continue = DEFNODE("Continue", null, {
    $documentation: "A `continue` statement"
}, AST_LoopControl);

/* -----[ IF ]----- */

var AST_If = DEFNODE("If", "condition alternative", {
    $documentation: "A `if` statement",
    $propdoc: {
        condition: "[AST_Node] the `if` condition",
        alternative: "[AST_Statement?] the `else` part, or null if not present"
    },
    _equals: function(node) {
        return this.body.equals(node.body)
            && this.condition.equals(node.condition)
            && prop_equals(this.alternative, node.alternative);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.condition.walk(visitor);
            node.body.walk(visitor);
            if (node.alternative) node.alternative.walk(visitor);
        });
    },
    _validate: function() {
        must_be_expression(this, "condition");
        if (this.alternative != null) {
            if (!is_statement(this.alternative)) throw new Error("alternative must be AST_Statement");
        }
    },
}, AST_StatementWithBody);

/* -----[ SWITCH ]----- */

var AST_Switch = DEFNODE("Switch", "expression", {
    $documentation: "A `switch` statement",
    $propdoc: {
        expression: "[AST_Node] the `switch` “discriminant”"
    },
    _equals: function(node) {
        return this.expression.equals(node.expression)
            && all_equals(this.body, node.body);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.expression.walk(visitor);
            walk_body(node, visitor);
        });
    },
    _validate: function() {
        must_be_expression(this, "expression");
        this.body.forEach(function(node) {
            if (!(node instanceof AST_SwitchBranch)) throw new Error("body must be AST_SwitchBranch[]");
        });
    },
}, AST_Block);

var AST_SwitchBranch = DEFNODE("SwitchBranch", null, {
    $documentation: "Base class for `switch` branches",
    _validate: function() {
        if (this.TYPE == "SwitchBranch") throw new Error("should not instantiate AST_SwitchBranch");
    },
}, AST_Block);

var AST_Default = DEFNODE("Default", null, {
    $documentation: "A `default` switch branch",
}, AST_SwitchBranch);

var AST_Case = DEFNODE("Case", "expression", {
    $documentation: "A `case` switch branch",
    $propdoc: {
        expression: "[AST_Node] the `case` expression"
    },
    _equals: function(node) {
        return this.expression.equals(node.expression)
            && all_equals(this.body, node.body);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.expression.walk(visitor);
            walk_body(node, visitor);
        });
    },
    _validate: function() {
        must_be_expression(this, "expression");
    },
}, AST_SwitchBranch);

/* -----[ EXCEPTIONS ]----- */

var AST_Try = DEFNODE("Try", "bcatch bfinally", {
    $documentation: "A `try` statement",
    $propdoc: {
        bcatch: "[AST_Catch?] the catch block, or null if not present",
        bfinally: "[AST_Finally?] the finally block, or null if not present"
    },
    _equals: function(node) {
        return all_equals(this.body, node.body)
            && prop_equals(this.bcatch, node.bcatch)
            && prop_equals(this.bfinally, node.bfinally);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            walk_body(node, visitor);
            if (node.bcatch) node.bcatch.walk(visitor);
            if (node.bfinally) node.bfinally.walk(visitor);
        });
    },
    _validate: function() {
        if (this.bcatch != null) {
            if (!(this.bcatch instanceof AST_Catch)) throw new Error("bcatch must be AST_Catch");
        }
        if (this.bfinally != null) {
            if (!(this.bfinally instanceof AST_Finally)) throw new Error("bfinally must be AST_Finally");
        }
    },
}, AST_Block);

var AST_Catch = DEFNODE("Catch", "argname", {
    $documentation: "A `catch` node; only makes sense as part of a `try` statement",
    $propdoc: {
        argname: "[(AST_Destructured|AST_SymbolCatch)?] symbol for the exception, or null if not present",
    },
    _equals: function(node) {
        return prop_equals(this.argname, node.argname)
            && all_equals(this.body, node.body);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            if (node.argname) node.argname.walk(visitor);
            walk_body(node, visitor);
        });
    },
    _validate: function() {
        if (this.argname != null) validate_destructured(this.argname, function(node) {
            if (!(node instanceof AST_SymbolCatch)) throw new Error("argname must be AST_SymbolCatch");
        });
    },
}, AST_Block);

var AST_Finally = DEFNODE("Finally", null, {
    $documentation: "A `finally` node; only makes sense as part of a `try` statement"
}, AST_Block);

/* -----[ VAR ]----- */

var AST_Definitions = DEFNODE("Definitions", "definitions", {
    $documentation: "Base class for `var` nodes (variable declarations/initializations)",
    $propdoc: {
        definitions: "[AST_VarDef*] array of variable definitions"
    },
    _equals: function(node) {
        return all_equals(this.definitions, node.definitions);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.definitions.forEach(function(defn) {
                defn.walk(visitor);
            });
        });
    },
    _validate: function() {
        if (this.TYPE == "Definitions") throw new Error("should not instantiate AST_Definitions");
        if (this.definitions.length < 1) throw new Error("must have at least one definition");
    },
}, AST_Statement);

var AST_Const = DEFNODE("Const", null, {
    $documentation: "A `const` statement",
    _validate: function() {
        this.definitions.forEach(function(node) {
            if (!(node instanceof AST_VarDef)) throw new Error("definitions must be AST_VarDef[]");
            validate_destructured(node.name, function(node) {
                if (!(node instanceof AST_SymbolConst)) throw new Error("name must be AST_SymbolConst");
            });
        });
    },
}, AST_Definitions);

var AST_Let = DEFNODE("Let", null, {
    $documentation: "A `let` statement",
    _validate: function() {
        this.definitions.forEach(function(node) {
            if (!(node instanceof AST_VarDef)) throw new Error("definitions must be AST_VarDef[]");
            validate_destructured(node.name, function(node) {
                if (!(node instanceof AST_SymbolLet)) throw new Error("name must be AST_SymbolLet");
            });
        });
    },
}, AST_Definitions);

var AST_Var = DEFNODE("Var", null, {
    $documentation: "A `var` statement",
    _validate: function() {
        this.definitions.forEach(function(node) {
            if (!(node instanceof AST_VarDef)) throw new Error("definitions must be AST_VarDef[]");
            validate_destructured(node.name, function(node) {
                if (!(node instanceof AST_SymbolVar)) throw new Error("name must be AST_SymbolVar");
            });
        });
    },
}, AST_Definitions);

var AST_VarDef = DEFNODE("VarDef", "name value", {
    $documentation: "A variable declaration; only appears in a AST_Definitions node",
    $propdoc: {
        name: "[AST_Destructured|AST_SymbolVar] name of the variable",
        value: "[AST_Node?] initializer, or null of there's no initializer",
    },
    _equals: function(node) {
        return this.name.equals(node.name)
            && prop_equals(this.value, node.value);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.name.walk(visitor);
            if (node.value) node.value.walk(visitor);
        });
    },
    _validate: function() {
        if (this.value != null) must_be_expression(this, "value");
    },
});

/* -----[ OTHER ]----- */

var AST_ExportDeclaration = DEFNODE("ExportDeclaration", "body", {
    $documentation: "An `export` statement",
    $propdoc: {
        body: "[AST_DefClass|AST_Definitions|AST_LambdaDefinition] the statement to export",
    },
    _equals: function(node) {
        return this.body.equals(node.body);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.body.walk(visitor);
        });
    },
    _validate: function() {
        if (!(this.body instanceof AST_DefClass
            || this.body instanceof AST_Definitions
            || this.body instanceof AST_LambdaDefinition)) {
            throw new Error("body must be AST_DefClass, AST_Definitions or AST_LambdaDefinition");
        }
    },
}, AST_Statement);

var AST_ExportDefault = DEFNODE("ExportDefault", "body", {
    $documentation: "An `export default` statement",
    $propdoc: {
        body: "[AST_Node] the default export",
    },
    _equals: function(node) {
        return this.body.equals(node.body);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.body.walk(visitor);
        });
    },
    _validate: function() {
        if (!(this.body instanceof AST_DefClass || this.body instanceof AST_LambdaDefinition)) {
            must_be_expression(this, "body");
        }
    },
}, AST_Statement);

var AST_ExportForeign = DEFNODE("ExportForeign", "aliases keys path", {
    $documentation: "An `export ... from '...'` statement",
    $propdoc: {
        aliases: "[AST_String*] array of aliases to export",
        keys: "[AST_String*] array of keys to import",
        path: "[AST_String] the path to import module",
    },
    _equals: function(node) {
        return this.path.equals(node.path)
            && all_equals(this.aliases, node.aliases)
            && all_equals(this.keys, node.keys);
    },
    _validate: function() {
        if (this.aliases.length != this.keys.length) {
            throw new Error("aliases:key length mismatch: " + this.aliases.length + " != " + this.keys.length);
        }
        this.aliases.forEach(function(name) {
            if (!(name instanceof AST_String)) throw new Error("aliases must contain AST_String");
        });
        this.keys.forEach(function(name) {
            if (!(name instanceof AST_String)) throw new Error("keys must contain AST_String");
        });
        if (!(this.path instanceof AST_String)) throw new Error("path must be AST_String");
    },
}, AST_Statement);

var AST_ExportReferences = DEFNODE("ExportReferences", "properties", {
    $documentation: "An `export { ... }` statement",
    $propdoc: {
        properties: "[AST_SymbolExport*] array of aliases to export",
    },
    _equals: function(node) {
        return all_equals(this.properties, node.properties);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.properties.forEach(function(prop) {
                prop.walk(visitor);
            });
        });
    },
    _validate: function() {
        this.properties.forEach(function(prop) {
            if (!(prop instanceof AST_SymbolExport)) throw new Error("properties must contain AST_SymbolExport");
        });
    },
}, AST_Statement);

var AST_Import = DEFNODE("Import", "all default path properties", {
    $documentation: "An `import` statement",
    $propdoc: {
        all: "[AST_SymbolImport?] the imported namespace, or null if not specified",
        default: "[AST_SymbolImport?] the alias for default `export`, or null if not specified",
        path: "[AST_String] the path to import module",
        properties: "[(AST_SymbolImport*)?] array of aliases, or null if not specified",
    },
    _equals: function(node) {
        return this.path.equals(node.path)
            && prop_equals(this.all, node.all)
            && prop_equals(this.default, node.default)
            && !this.properties == !node.properties
            && (!this.properties || all_equals(this.properties, node.properties));
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            if (node.all) node.all.walk(visitor);
            if (node.default) node.default.walk(visitor);
            if (node.properties) node.properties.forEach(function(prop) {
                prop.walk(visitor);
            });
        });
    },
    _validate: function() {
        if (this.all != null) {
            if (!(this.all instanceof AST_SymbolImport)) throw new Error("all must be AST_SymbolImport");
            if (this.properties != null) throw new Error("cannot import both * and {} in the same statement");
        }
        if (this.default != null) {
            if (!(this.default instanceof AST_SymbolImport)) throw new Error("default must be AST_SymbolImport");
            if (this.default.key.value !== "") throw new Error("invalid default key: " + this.default.key.value);
        }
        if (!(this.path instanceof AST_String)) throw new Error("path must be AST_String");
        if (this.properties != null) this.properties.forEach(function(node) {
            if (!(node instanceof AST_SymbolImport)) throw new Error("properties must contain AST_SymbolImport");
        });
    },
}, AST_Statement);

var AST_DefaultValue = DEFNODE("DefaultValue", "name value", {
    $documentation: "A default value declaration",
    $propdoc: {
        name: "[AST_Destructured|AST_SymbolDeclaration] name of the variable",
        value: "[AST_Node] value to assign if variable is `undefined`",
    },
    _equals: function(node) {
        return this.name.equals(node.name)
            && this.value.equals(node.value);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.name.walk(visitor);
            node.value.walk(visitor);
        });
    },
    _validate: function() {
        must_be_expression(this, "value");
    },
});

function must_be_expressions(node, prop, allow_spread, allow_hole) {
    node[prop].forEach(function(node) {
        validate_expression(node, prop, true, allow_spread, allow_hole);
    });
}

var AST_Call = DEFNODE("Call", "args expression optional pure terminal", {
    $documentation: "A function call expression",
    $propdoc: {
        args: "[AST_Node*] array of arguments",
        expression: "[AST_Node] expression to invoke as function",
        optional: "[boolean] whether the expression is optional chaining",
        pure: "[boolean/S] marker for side-effect-free call expression",
        terminal: "[boolean] whether the chain has ended",
    },
    _equals: function(node) {
        return !this.optional == !node.optional
            && this.expression.equals(node.expression)
            && all_equals(this.args, node.args);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.expression.walk(visitor);
            node.args.forEach(function(arg) {
                arg.walk(visitor);
            });
        });
    },
    _validate: function() {
        must_be_expression(this, "expression");
        must_be_expressions(this, "args", true);
    },
});

var AST_New = DEFNODE("New", null, {
    $documentation: "An object instantiation.  Derives from a function call since it has exactly the same properties",
    _validate: function() {
        if (this.optional) throw new Error("optional must be false");
        if (this.terminal) throw new Error("terminal must be false");
    },
}, AST_Call);

var AST_Sequence = DEFNODE("Sequence", "expressions", {
    $documentation: "A sequence expression (comma-separated expressions)",
    $propdoc: {
        expressions: "[AST_Node*] array of expressions (at least two)",
    },
    _equals: function(node) {
        return all_equals(this.expressions, node.expressions);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.expressions.forEach(function(expr) {
                expr.walk(visitor);
            });
        });
    },
    _validate: function() {
        if (this.expressions.length < 2) throw new Error("expressions must contain multiple elements");
        must_be_expressions(this, "expressions");
    },
});

function root_expr(prop) {
    while (prop instanceof AST_PropAccess) prop = prop.expression;
    return prop;
}

var AST_PropAccess = DEFNODE("PropAccess", "expression optional property terminal", {
    $documentation: "Base class for property access expressions, i.e. `a.foo` or `a[\"foo\"]`",
    $propdoc: {
        expression: "[AST_Node] the “container” expression",
        optional: "[boolean] whether the expression is optional chaining",
        property: "[AST_Node|string] the property to access.  For AST_Dot this is always a plain string, while for AST_Sub it's an arbitrary AST_Node",
        terminal: "[boolean] whether the chain has ended",
    },
    _equals: function(node) {
        return !this.optional == !node.optional
            && prop_equals(this.property, node.property)
            && this.expression.equals(node.expression);
    },
    get_property: function() {
        var p = this.property;
        if (p instanceof AST_Constant) return p.value;
        if (p instanceof AST_UnaryPrefix && p.operator == "void" && p.expression instanceof AST_Constant) return;
        return p;
    },
    _validate: function() {
        if (this.TYPE == "PropAccess") throw new Error("should not instantiate AST_PropAccess");
        must_be_expression(this, "expression");
    },
});

var AST_Dot = DEFNODE("Dot", "quoted", {
    $documentation: "A dotted property access expression",
    $propdoc: {
        quoted: "[boolean] whether property is transformed from a quoted string",
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.expression.walk(visitor);
        });
    },
    _validate: function() {
        if (typeof this.property != "string") throw new Error("property must be string");
    },
}, AST_PropAccess);

var AST_Sub = DEFNODE("Sub", null, {
    $documentation: "Index-style property access, i.e. `a[\"foo\"]`",
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.expression.walk(visitor);
            node.property.walk(visitor);
        });
    },
    _validate: function() {
        must_be_expression(this, "property");
    },
}, AST_PropAccess);

var AST_Spread = DEFNODE("Spread", "expression", {
    $documentation: "Spread expression in array/object literals or function calls",
    $propdoc: {
        expression: "[AST_Node] expression to be expanded",
    },
    _equals: function(node) {
        return this.expression.equals(node.expression);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.expression.walk(visitor);
        });
    },
    _validate: function() {
        must_be_expression(this, "expression");
    },
});

var AST_Unary = DEFNODE("Unary", "operator expression", {
    $documentation: "Base class for unary expressions",
    $propdoc: {
        operator: "[string] the operator",
        expression: "[AST_Node] expression that this unary operator applies to",
    },
    _equals: function(node) {
        return this.operator == node.operator
            && this.expression.equals(node.expression);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.expression.walk(visitor);
        });
    },
    _validate: function() {
        if (this.TYPE == "Unary") throw new Error("should not instantiate AST_Unary");
        if (typeof this.operator != "string") throw new Error("operator must be string");
        must_be_expression(this, "expression");
    },
});

var AST_UnaryPrefix = DEFNODE("UnaryPrefix", null, {
    $documentation: "Unary prefix expression, i.e. `typeof i` or `++i`"
}, AST_Unary);

var AST_UnaryPostfix = DEFNODE("UnaryPostfix", null, {
    $documentation: "Unary postfix expression, i.e. `i++`"
}, AST_Unary);

var AST_Binary = DEFNODE("Binary", "operator left right", {
    $documentation: "Binary expression, i.e. `a + b`",
    $propdoc: {
        left: "[AST_Node] left-hand side expression",
        operator: "[string] the operator",
        right: "[AST_Node] right-hand side expression"
    },
    _equals: function(node) {
        return this.operator == node.operator
            && this.left.equals(node.left)
            && this.right.equals(node.right);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.left.walk(visitor);
            node.right.walk(visitor);
        });
    },
    _validate: function() {
        if (!(this instanceof AST_Assign)) must_be_expression(this, "left");
        if (typeof this.operator != "string") throw new Error("operator must be string");
        must_be_expression(this, "right");
    },
});

var AST_Conditional = DEFNODE("Conditional", "condition consequent alternative", {
    $documentation: "Conditional expression using the ternary operator, i.e. `a ? b : c`",
    $propdoc: {
        condition: "[AST_Node]",
        consequent: "[AST_Node]",
        alternative: "[AST_Node]"
    },
    _equals: function(node) {
        return this.condition.equals(node.condition)
            && this.consequent.equals(node.consequent)
            && this.alternative.equals(node.alternative);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.condition.walk(visitor);
            node.consequent.walk(visitor);
            node.alternative.walk(visitor);
        });
    },
    _validate: function() {
        must_be_expression(this, "condition");
        must_be_expression(this, "consequent");
        must_be_expression(this, "alternative");
    },
});

var AST_Assign = DEFNODE("Assign", null, {
    $documentation: "An assignment expression — `a = b + 5`",
    _validate: function() {
        if (this.operator.indexOf("=") < 0) throw new Error('operator must contain "="');
        if (this.left instanceof AST_Destructured) {
            if (this.operator != "=") throw new Error("invalid destructuring operator: " + this.operator);
            validate_destructured(this.left, function(node) {
                if (!(node instanceof AST_PropAccess || node instanceof AST_SymbolRef)) {
                    throw new Error("left must be assignable: " + node.TYPE);
                }
            });
        } else if (!(this.left instanceof AST_Infinity
            || this.left instanceof AST_NaN
            || this.left instanceof AST_PropAccess && !this.left.optional
            || this.left instanceof AST_SymbolRef
            || this.left instanceof AST_Undefined)) {
            throw new Error("left must be assignable");
        }
    },
}, AST_Binary);

var AST_Await = DEFNODE("Await", "expression", {
    $documentation: "An await expression",
    $propdoc: {
        expression: "[AST_Node] expression with Promise to resolve on",
    },
    _equals: function(node) {
        return this.expression.equals(node.expression);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.expression.walk(visitor);
        });
    },
    _validate: function() {
        must_be_expression(this, "expression");
    },
});

var AST_Yield = DEFNODE("Yield", "expression nested", {
    $documentation: "A yield expression",
    $propdoc: {
        expression: "[AST_Node?] return value for iterator, or null if undefined",
        nested: "[boolean] whether to iterate over expression as generator",
    },
    _equals: function(node) {
        return !this.nested == !node.nested
            && prop_equals(this.expression, node.expression);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            if (node.expression) node.expression.walk(visitor);
        });
    },
    _validate: function() {
        if (this.expression != null) {
            must_be_expression(this, "expression");
        } else if (this.nested) {
            throw new Error("yield* must contain expression");
        }
    },
});

/* -----[ LITERALS ]----- */

var AST_Array = DEFNODE("Array", "elements", {
    $documentation: "An array literal",
    $propdoc: {
        elements: "[AST_Node*] array of elements"
    },
    _equals: function(node) {
        return all_equals(this.elements, node.elements);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.elements.forEach(function(element) {
                element.walk(visitor);
            });
        });
    },
    _validate: function() {
        must_be_expressions(this, "elements", true, true);
    },
});

var AST_Destructured = DEFNODE("Destructured", "rest", {
    $documentation: "Base class for destructured literal",
    $propdoc: {
        rest: "[(AST_Destructured|AST_SymbolDeclaration|AST_SymbolRef)?] rest parameter, or null if absent",
    },
    _validate: function() {
        if (this.TYPE == "Destructured") throw new Error("should not instantiate AST_Destructured");
    },
});

function validate_destructured(node, check, allow_default) {
    if (node instanceof AST_DefaultValue && allow_default) return validate_destructured(node.name, check);
    if (node instanceof AST_Destructured) {
        if (node.rest != null) validate_destructured(node.rest, check);
        if (node instanceof AST_DestructuredArray) return node.elements.forEach(function(node) {
            if (!(node instanceof AST_Hole)) validate_destructured(node, check, true);
        });
        if (node instanceof AST_DestructuredObject) return node.properties.forEach(function(prop) {
            validate_destructured(prop.value, check, true);
        });
    }
    check(node);
}

var AST_DestructuredArray = DEFNODE("DestructuredArray", "elements", {
    $documentation: "A destructured array literal",
    $propdoc: {
        elements: "[(AST_DefaultValue|AST_Destructured|AST_SymbolDeclaration|AST_SymbolRef)*] array of elements",
    },
    _equals: function(node) {
        return prop_equals(this.rest, node.rest)
            && all_equals(this.elements, node.elements);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.elements.forEach(function(element) {
                element.walk(visitor);
            });
            if (node.rest) node.rest.walk(visitor);
        });
    },
}, AST_Destructured);

var AST_DestructuredKeyVal = DEFNODE("DestructuredKeyVal", "key value", {
    $documentation: "A key: value destructured property",
    $propdoc: {
        key: "[string|AST_Node] property name.  For computed property this is an AST_Node.",
        value: "[AST_DefaultValue|AST_Destructured|AST_SymbolDeclaration|AST_SymbolRef] property value",
    },
    _equals: function(node) {
        return prop_equals(this.key, node.key)
            && this.value.equals(node.value);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            if (node.key instanceof AST_Node) node.key.walk(visitor);
            node.value.walk(visitor);
        });
    },
    _validate: function() {
        if (typeof this.key != "string") {
            if (!(this.key instanceof AST_Node)) throw new Error("key must be string or AST_Node");
            must_be_expression(this, "key");
        }
        if (!(this.value instanceof AST_Node)) throw new Error("value must be AST_Node");
    },
});

var AST_DestructuredObject = DEFNODE("DestructuredObject", "properties", {
    $documentation: "A destructured object literal",
    $propdoc: {
        properties: "[AST_DestructuredKeyVal*] array of properties",
    },
    _equals: function(node) {
        return prop_equals(this.rest, node.rest)
            && all_equals(this.properties, node.properties);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.properties.forEach(function(prop) {
                prop.walk(visitor);
            });
            if (node.rest) node.rest.walk(visitor);
        });
    },
    _validate: function() {
        this.properties.forEach(function(node) {
            if (!(node instanceof AST_DestructuredKeyVal)) throw new Error("properties must be AST_DestructuredKeyVal[]");
        });
    },
}, AST_Destructured);

var AST_Object = DEFNODE("Object", "properties", {
    $documentation: "An object literal",
    $propdoc: {
        properties: "[(AST_ObjectProperty|AST_Spread)*] array of properties"
    },
    _equals: function(node) {
        return all_equals(this.properties, node.properties);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            node.properties.forEach(function(prop) {
                prop.walk(visitor);
            });
        });
    },
    _validate: function() {
        this.properties.forEach(function(node) {
            if (!(node instanceof AST_ObjectProperty || node instanceof AST_Spread)) {
                throw new Error("properties must contain AST_ObjectProperty and/or AST_Spread only");
            }
        });
    },
});

var AST_ObjectProperty = DEFNODE("ObjectProperty", "key value", {
    $documentation: "Base class for literal object properties",
    $propdoc: {
        key: "[string|AST_Node] property name.  For computed property this is an AST_Node.",
        value: "[AST_Node] property value.  For getters and setters this is an AST_Accessor.",
    },
    _equals: function(node) {
        return prop_equals(this.key, node.key)
            && this.value.equals(node.value);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            if (node.key instanceof AST_Node) node.key.walk(visitor);
            node.value.walk(visitor);
        });
    },
    _validate: function() {
        if (this.TYPE == "ObjectProperty") throw new Error("should not instantiate AST_ObjectProperty");
        if (typeof this.key != "string") {
            if (!(this.key instanceof AST_Node)) throw new Error("key must be string or AST_Node");
            must_be_expression(this, "key");
        }
        if (!(this.value instanceof AST_Node)) throw new Error("value must be AST_Node");
    },
});

var AST_ObjectKeyVal = DEFNODE("ObjectKeyVal", null, {
    $documentation: "A key: value object property",
    _validate: function() {
        must_be_expression(this, "value");
    },
}, AST_ObjectProperty);

var AST_ObjectMethod = DEFNODE("ObjectMethod", null, {
    $documentation: "A key(){} object property",
    _validate: function() {
        if (!(this.value instanceof AST_LambdaExpression)) throw new Error("value must be AST_LambdaExpression");
        if (is_arrow(this.value)) throw new Error("value cannot be AST_Arrow or AST_AsyncArrow");
        if (this.value.name != null) throw new Error("name of object method's lambda must be null");
    },
}, AST_ObjectKeyVal);

var AST_ObjectSetter = DEFNODE("ObjectSetter", null, {
    $documentation: "An object setter property",
    _validate: function() {
        if (!(this.value instanceof AST_Accessor)) throw new Error("value must be AST_Accessor");
    },
}, AST_ObjectProperty);

var AST_ObjectGetter = DEFNODE("ObjectGetter", null, {
    $documentation: "An object getter property",
    _validate: function() {
        if (!(this.value instanceof AST_Accessor)) throw new Error("value must be AST_Accessor");
    },
}, AST_ObjectProperty);

var AST_Symbol = DEFNODE("Symbol", "scope name thedef", {
    $documentation: "Base class for all symbols",
    $propdoc: {
        name: "[string] name of this symbol",
        scope: "[AST_Scope/S] the current scope (not necessarily the definition scope)",
        thedef: "[SymbolDef/S] the definition of this symbol"
    },
    _equals: function(node) {
        return this.thedef ? this.thedef === node.thedef : this.name == node.name;
    },
    _validate: function() {
        if (this.TYPE == "Symbol") throw new Error("should not instantiate AST_Symbol");
        if (typeof this.name != "string") throw new Error("name must be string");
    },
});

var AST_SymbolDeclaration = DEFNODE("SymbolDeclaration", "init", {
    $documentation: "A declaration symbol (symbol in var, function name or argument, symbol in catch)",
}, AST_Symbol);

var AST_SymbolConst = DEFNODE("SymbolConst", null, {
    $documentation: "Symbol defining a constant",
}, AST_SymbolDeclaration);

var AST_SymbolImport = DEFNODE("SymbolImport", "key", {
    $documentation: "Symbol defined by an `import` statement",
    $propdoc: {
        key: "[AST_String] the original `export` name",
    },
    _equals: function(node) {
        return this.name == node.name
            && this.key.equals(node.key);
    },
    _validate: function() {
        if (!(this.key instanceof AST_String)) throw new Error("key must be AST_String");
    },
}, AST_SymbolConst);

var AST_SymbolLet = DEFNODE("SymbolLet", null, {
    $documentation: "Symbol defining a lexical-scoped variable",
}, AST_SymbolDeclaration);

var AST_SymbolVar = DEFNODE("SymbolVar", null, {
    $documentation: "Symbol defining a variable",
}, AST_SymbolDeclaration);

var AST_SymbolFunarg = DEFNODE("SymbolFunarg", "unused", {
    $documentation: "Symbol naming a function argument",
}, AST_SymbolVar);

var AST_SymbolDefun = DEFNODE("SymbolDefun", null, {
    $documentation: "Symbol defining a function",
}, AST_SymbolDeclaration);

var AST_SymbolLambda = DEFNODE("SymbolLambda", null, {
    $documentation: "Symbol naming a function expression",
}, AST_SymbolDeclaration);

var AST_SymbolDefClass = DEFNODE("SymbolDefClass", null, {
    $documentation: "Symbol defining a class",
}, AST_SymbolConst);

var AST_SymbolClass = DEFNODE("SymbolClass", null, {
    $documentation: "Symbol naming a class expression",
}, AST_SymbolConst);

var AST_SymbolCatch = DEFNODE("SymbolCatch", null, {
    $documentation: "Symbol naming the exception in catch",
}, AST_SymbolDeclaration);

var AST_Label = DEFNODE("Label", "references", {
    $documentation: "Symbol naming a label (declaration)",
    $propdoc: {
        references: "[AST_LoopControl*] a list of nodes referring to this label"
    },
    initialize: function() {
        this.references = [];
        this.thedef = this;
    },
}, AST_Symbol);

var AST_SymbolRef = DEFNODE("SymbolRef", "fixed in_arg redef", {
    $documentation: "Reference to some symbol (not definition/declaration)",
}, AST_Symbol);

var AST_SymbolExport = DEFNODE("SymbolExport", "alias", {
    $documentation: "Reference in an `export` statement",
    $propdoc: {
        alias: "[AST_String] the `export` alias",
    },
    _equals: function(node) {
        return this.name == node.name
            && this.alias.equals(node.alias);
    },
    _validate: function() {
        if (!(this.alias instanceof AST_String)) throw new Error("alias must be AST_String");
    },
}, AST_SymbolRef);

var AST_LabelRef = DEFNODE("LabelRef", null, {
    $documentation: "Reference to a label symbol",
}, AST_Symbol);

var AST_ObjectIdentity = DEFNODE("ObjectIdentity", null, {
    $documentation: "Base class for `super` & `this`",
    _equals: return_true,
    _validate: function() {
        if (this.TYPE == "ObjectIdentity") throw new Error("should not instantiate AST_ObjectIdentity");
    },
}, AST_Symbol);

var AST_Super = DEFNODE("Super", null, {
    $documentation: "The `super` symbol",
    _validate: function() {
        if (this.name !== "super") throw new Error('name must be "super"');
    },
}, AST_ObjectIdentity);

var AST_This = DEFNODE("This", null, {
    $documentation: "The `this` symbol",
    _validate: function() {
        if (this.TYPE == "This" && this.name !== "this") throw new Error('name must be "this"');
    },
}, AST_ObjectIdentity);

var AST_NewTarget = DEFNODE("NewTarget", null, {
    $documentation: "The `new.target` symbol",
    initialize: function() {
        this.name = "new.target";
    },
    _validate: function() {
        if (this.name !== "new.target") throw new Error('name must be "new.target": ' + this.name);
    },
}, AST_This);

var AST_Template = DEFNODE("Template", "expressions strings tag", {
    $documentation: "A template literal, i.e. tag`str1${expr1}...strN${exprN}strN+1`",
    $propdoc: {
        expressions: "[AST_Node*] the placeholder expressions",
        strings: "[string*] the raw text segments",
        tag: "[AST_Node?] tag function, or null if absent",
    },
    _equals: function(node) {
        return prop_equals(this.tag, node.tag)
            && list_equals(this.strings, node.strings)
            && all_equals(this.expressions, node.expressions);
    },
    walk: function(visitor) {
        var node = this;
        visitor.visit(node, function() {
            if (node.tag) node.tag.walk(visitor);
            node.expressions.forEach(function(expr) {
                expr.walk(visitor);
            });
        });
    },
    _validate: function() {
        if (this.expressions.length + 1 != this.strings.length) {
            throw new Error("malformed template with " + this.expressions.length + " placeholder(s) but " + this.strings.length + " text segment(s)");
        }
        must_be_expressions(this, "expressions");
        this.strings.forEach(function(string) {
            if (typeof string != "string") throw new Error("strings must contain string");
        });
        if (this.tag != null) must_be_expression(this, "tag");
    },
});

var AST_Constant = DEFNODE("Constant", null, {
    $documentation: "Base class for all constants",
    _equals: function(node) {
        return this.value === node.value;
    },
    _validate: function() {
        if (this.TYPE == "Constant") throw new Error("should not instantiate AST_Constant");
    },
});

var AST_String = DEFNODE("String", "quote value", {
    $documentation: "A string literal",
    $propdoc: {
        quote: "[string?] the original quote character",
        value: "[string] the contents of this string",
    },
    _validate: function() {
        if (this.quote != null) {
            if (typeof this.quote != "string") throw new Error("quote must be string");
            if (!/^["']$/.test(this.quote)) throw new Error("invalid quote: " + this.quote);
        }
        if (typeof this.value != "string") throw new Error("value must be string");
    },
}, AST_Constant);

var AST_Number = DEFNODE("Number", "value", {
    $documentation: "A number literal",
    $propdoc: {
        value: "[number] the numeric value",
    },
    _validate: function() {
        if (typeof this.value != "number") throw new Error("value must be number");
        if (!isFinite(this.value)) throw new Error("value must be finite");
        if (this.value < 0) throw new Error("value cannot be negative");
    },
}, AST_Constant);

var AST_BigInt = DEFNODE("BigInt", "value", {
    $documentation: "A BigInt literal",
    $propdoc: {
        value: "[string] the numeric representation",
    },
    _validate: function() {
        if (typeof this.value != "string") throw new Error("value must be string");
        if (this.value[0] == "-") throw new Error("value cannot be negative");
    },
}, AST_Constant);

var AST_RegExp = DEFNODE("RegExp", "value", {
    $documentation: "A regexp literal",
    $propdoc: {
        value: "[RegExp] the actual regexp"
    },
    _equals: function(node) {
        return "" + this.value == "" + node.value;
    },
    _validate: function() {
        if (!(this.value instanceof RegExp)) throw new Error("value must be RegExp");
    },
}, AST_Constant);

var AST_Atom = DEFNODE("Atom", null, {
    $documentation: "Base class for atoms",
    _equals: return_true,
    _validate: function() {
        if (this.TYPE == "Atom") throw new Error("should not instantiate AST_Atom");
    },
}, AST_Constant);

var AST_Null = DEFNODE("Null", null, {
    $documentation: "The `null` atom",
    value: null,
}, AST_Atom);

var AST_NaN = DEFNODE("NaN", null, {
    $documentation: "The impossible value",
    value: 0/0,
}, AST_Atom);

var AST_Undefined = DEFNODE("Undefined", null, {
    $documentation: "The `undefined` value",
    value: function(){}(),
}, AST_Atom);

var AST_Hole = DEFNODE("Hole", null, {
    $documentation: "A hole in an array",
    value: function(){}(),
}, AST_Atom);

var AST_Infinity = DEFNODE("Infinity", null, {
    $documentation: "The `Infinity` value",
    value: 1/0,
}, AST_Atom);

var AST_Boolean = DEFNODE("Boolean", null, {
    $documentation: "Base class for booleans",
    _validate: function() {
        if (this.TYPE == "Boolean") throw new Error("should not instantiate AST_Boolean");
    },
}, AST_Atom);

var AST_False = DEFNODE("False", null, {
    $documentation: "The `false` atom",
    value: false,
}, AST_Boolean);

var AST_True = DEFNODE("True", null, {
    $documentation: "The `true` atom",
    value: true,
}, AST_Boolean);

/* -----[ TreeWalker ]----- */

function TreeWalker(callback) {
    this.callback = callback;
    this.directives = Object.create(null);
    this.stack = [];
}
TreeWalker.prototype = {
    visit: function(node, descend) {
        this.push(node);
        var done = this.callback(node, descend || noop);
        if (!done && descend) descend();
        this.pop();
    },
    parent: function(n) {
        return this.stack[this.stack.length - 2 - (n || 0)];
    },
    push: function(node) {
        var value;
        if (node instanceof AST_Class) {
            this.directives = Object.create(this.directives);
            value = "use strict";
        } else if (node instanceof AST_Directive) {
            value = node.value;
        } else if (node instanceof AST_Lambda) {
            this.directives = Object.create(this.directives);
        }
        if (value && !this.directives[value]) this.directives[value] = node;
        this.stack.push(node);
    },
    pop: function() {
        var node = this.stack.pop();
        if (node instanceof AST_Class || node instanceof AST_Lambda) {
            this.directives = Object.getPrototypeOf(this.directives);
        }
    },
    self: function() {
        return this.stack[this.stack.length - 1];
    },
    find_parent: function(type) {
        var stack = this.stack;
        for (var i = stack.length - 1; --i >= 0;) {
            var x = stack[i];
            if (x instanceof type) return x;
        }
    },
    has_directive: function(type) {
        var dir = this.directives[type];
        if (dir) return dir;
        var node = this.stack[this.stack.length - 1];
        if (node instanceof AST_Scope) {
            for (var i = 0; i < node.body.length; ++i) {
                var st = node.body[i];
                if (!(st instanceof AST_Directive)) break;
                if (st.value == type) return st;
            }
        }
    },
    loopcontrol_target: function(node) {
        var stack = this.stack;
        if (node.label) for (var i = stack.length; --i >= 0;) {
            var x = stack[i];
            if (x instanceof AST_LabeledStatement && x.label.name == node.label.name)
                return x.body;
        } else for (var i = stack.length; --i >= 0;) {
            var x = stack[i];
            if (x instanceof AST_IterationStatement
                || node instanceof AST_Break && x instanceof AST_Switch)
                return x;
        }
    },
    in_boolean_context: function() {
        for (var drop = true, level = 0, parent, self = this.self(); parent = this.parent(level++); self = parent) {
            if (parent instanceof AST_Binary) switch (parent.operator) {
              case "&&":
              case "||":
                if (parent.left === self) drop = false;
                continue;
              default:
                return false;
            }
            if (parent instanceof AST_Conditional) {
                if (parent.condition === self) return true;
                continue;
            }
            if (parent instanceof AST_DWLoop) return parent.condition === self;
            if (parent instanceof AST_For) return parent.condition === self;
            if (parent instanceof AST_If) return parent.condition === self;
            if (parent instanceof AST_Return) {
                if (parent.in_bool) return true;
                while (parent = this.parent(level++)) {
                    if (parent instanceof AST_Lambda) {
                        if (parent.name) return false;
                        parent = this.parent(level++);
                        if (parent.TYPE != "Call") return false;
                        break;
                    }
                }
            }
            if (parent instanceof AST_Sequence) {
                if (parent.tail_node() === self) continue;
                return drop ? "d" : true;
            }
            if (parent instanceof AST_SimpleStatement) return drop ? "d" : true;
            if (parent instanceof AST_UnaryPrefix) return parent.operator == "!";
            return false;
        }
    }
};


/***********************************************************************

  A JavaScript tokenizer / parser / beautifier / compressor.
  https://github.com/mishoo/UglifyJS

  -------------------------------- (C) ---------------------------------

                           Author: Mihai Bazon
                         <mihai.bazon@gmail.com>
                       http://mihai.bazon.net/blog

  Distributed under the BSD license:

    Copyright 2012 (c) Mihai Bazon <mihai.bazon@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:

        * Redistributions of source code must retain the above
          copyright notice, this list of conditions and the following
          disclaimer.

        * Redistributions in binary form must reproduce the above
          copyright notice, this list of conditions and the following
          disclaimer in the documentation and/or other materials
          provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
    EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
    PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
    OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
    PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
    PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
    TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
    THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
    SUCH DAMAGE.

 ***********************************************************************/

"use strict";

function TreeTransformer(before, after) {
    TreeWalker.call(this);
    this.before = before;
    this.after = after;
}
TreeTransformer.prototype = new TreeWalker;

(function(DEF) {
    function do_list(list, tw) {
        return List(list, function(node) {
            return node.transform(tw, true);
        });
    }

    DEF(AST_Node, noop);
    DEF(AST_LabeledStatement, function(self, tw) {
        self.label = self.label.transform(tw);
        self.body = self.body.transform(tw);
    });
    DEF(AST_SimpleStatement, function(self, tw) {
        self.body = self.body.transform(tw);
    });
    DEF(AST_Block, function(self, tw) {
        self.body = do_list(self.body, tw);
    });
    DEF(AST_Do, function(self, tw) {
        self.body = self.body.transform(tw);
        self.condition = self.condition.transform(tw);
    });
    DEF(AST_While, function(self, tw) {
        self.condition = self.condition.transform(tw);
        self.body = self.body.transform(tw);
    });
    DEF(AST_For, function(self, tw) {
        if (self.init) self.init = self.init.transform(tw);
        if (self.condition) self.condition = self.condition.transform(tw);
        if (self.step) self.step = self.step.transform(tw);
        self.body = self.body.transform(tw);
    });
    DEF(AST_ForEnumeration, function(self, tw) {
        self.init = self.init.transform(tw);
        self.object = self.object.transform(tw);
        self.body = self.body.transform(tw);
    });
    DEF(AST_With, function(self, tw) {
        self.expression = self.expression.transform(tw);
        self.body = self.body.transform(tw);
    });
    DEF(AST_Exit, function(self, tw) {
        if (self.value) self.value = self.value.transform(tw);
    });
    DEF(AST_LoopControl, function(self, tw) {
        if (self.label) self.label = self.label.transform(tw);
    });
    DEF(AST_If, function(self, tw) {
        self.condition = self.condition.transform(tw);
        self.body = self.body.transform(tw);
        if (self.alternative) self.alternative = self.alternative.transform(tw);
    });
    DEF(AST_Switch, function(self, tw) {
        self.expression = self.expression.transform(tw);
        self.body = do_list(self.body, tw);
    });
    DEF(AST_Case, function(self, tw) {
        self.expression = self.expression.transform(tw);
        self.body = do_list(self.body, tw);
    });
    DEF(AST_Try, function(self, tw) {
        self.body = do_list(self.body, tw);
        if (self.bcatch) self.bcatch = self.bcatch.transform(tw);
        if (self.bfinally) self.bfinally = self.bfinally.transform(tw);
    });
    DEF(AST_Catch, function(self, tw) {
        if (self.argname) self.argname = self.argname.transform(tw);
        self.body = do_list(self.body, tw);
    });
    DEF(AST_Definitions, function(self, tw) {
        self.definitions = do_list(self.definitions, tw);
    });
    DEF(AST_VarDef, function(self, tw) {
        self.name = self.name.transform(tw);
        if (self.value) self.value = self.value.transform(tw);
    });
    DEF(AST_DefaultValue, function(self, tw) {
        self.name = self.name.transform(tw);
        self.value = self.value.transform(tw);
    });
    DEF(AST_Lambda, function(self, tw) {
        if (self.name) self.name = self.name.transform(tw);
        self.argnames = do_list(self.argnames, tw);
        if (self.rest) self.rest = self.rest.transform(tw);
        self.body = do_list(self.body, tw);
    });
    function transform_arrow(self, tw) {
        self.argnames = do_list(self.argnames, tw);
        if (self.rest) self.rest = self.rest.transform(tw);
        if (self.value) {
            self.value = self.value.transform(tw);
        } else {
            self.body = do_list(self.body, tw);
        }
    }
    DEF(AST_Arrow, transform_arrow);
    DEF(AST_AsyncArrow, transform_arrow);
    DEF(AST_Class, function(self, tw) {
        if (self.name) self.name = self.name.transform(tw);
        if (self.extends) self.extends = self.extends.transform(tw);
        self.properties = do_list(self.properties, tw);
    });
    DEF(AST_ClassProperty, function(self, tw) {
        if (self.key instanceof AST_Node) self.key = self.key.transform(tw);
        if (self.value) self.value = self.value.transform(tw);
    });
    DEF(AST_Call, function(self, tw) {
        self.expression = self.expression.transform(tw);
        self.args = do_list(self.args, tw);
    });
    DEF(AST_Sequence, function(self, tw) {
        self.expressions = do_list(self.expressions, tw);
    });
    DEF(AST_Await, function(self, tw) {
        self.expression = self.expression.transform(tw);
    });
    DEF(AST_Yield, function(self, tw) {
        if (self.expression) self.expression = self.expression.transform(tw);
    });
    DEF(AST_Dot, function(self, tw) {
        self.expression = self.expression.transform(tw);
    });
    DEF(AST_Sub, function(self, tw) {
        self.expression = self.expression.transform(tw);
        self.property = self.property.transform(tw);
    });
    DEF(AST_Spread, function(self, tw) {
        self.expression = self.expression.transform(tw);
    });
    DEF(AST_Unary, function(self, tw) {
        self.expression = self.expression.transform(tw);
    });
    DEF(AST_Binary, function(self, tw) {
        self.left = self.left.transform(tw);
        self.right = self.right.transform(tw);
    });
    DEF(AST_Conditional, function(self, tw) {
        self.condition = self.condition.transform(tw);
        self.consequent = self.consequent.transform(tw);
        self.alternative = self.alternative.transform(tw);
    });
    DEF(AST_Array, function(self, tw) {
        self.elements = do_list(self.elements, tw);
    });
    DEF(AST_DestructuredArray, function(self, tw) {
        self.elements = do_list(self.elements, tw);
        if (self.rest) self.rest = self.rest.transform(tw);
    });
    DEF(AST_DestructuredKeyVal, function(self, tw) {
        if (self.key instanceof AST_Node) self.key = self.key.transform(tw);
        self.value = self.value.transform(tw);
    });
    DEF(AST_DestructuredObject, function(self, tw) {
        self.properties = do_list(self.properties, tw);
        if (self.rest) self.rest = self.rest.transform(tw);
    });
    DEF(AST_Object, function(self, tw) {
        self.properties = do_list(self.properties, tw);
    });
    DEF(AST_ObjectProperty, function(self, tw) {
        if (self.key instanceof AST_Node) self.key = self.key.transform(tw);
        self.value = self.value.transform(tw);
    });
    DEF(AST_ExportDeclaration, function(self, tw) {
        self.body = self.body.transform(tw);
    });
    DEF(AST_ExportDefault, function(self, tw) {
        self.body = self.body.transform(tw);
    });
    DEF(AST_ExportReferences, function(self, tw) {
        self.properties = do_list(self.properties, tw);
    });
    DEF(AST_Import, function(self, tw) {
        if (self.all) self.all = self.all.transform(tw);
        if (self.default) self.default = self.default.transform(tw);
        if (self.properties) self.properties = do_list(self.properties, tw);
    });
    DEF(AST_Template, function(self, tw) {
        if (self.tag) self.tag = self.tag.transform(tw);
        self.expressions = do_list(self.expressions, tw);
    });
})(function(node, descend) {
    node.DEFMETHOD("transform", function(tw, in_list) {
        var x, y;
        tw.push(this);
        if (tw.before) x = tw.before(this, descend, in_list);
        if (typeof x === "undefined") {
            x = this;
            descend(x, tw);
            if (tw.after) {
                y = tw.after(x, in_list);
                if (typeof y !== "undefined") x = y;
            }
        }
        tw.pop();
        return x;
    });
});


/***********************************************************************

  A JavaScript tokenizer / parser / beautifier / compressor.
  https://github.com/mishoo/UglifyJS

  -------------------------------- (C) ---------------------------------

                           Author: Mihai Bazon
                         <mihai.bazon@gmail.com>
                       http://mihai.bazon.net/blog

  Distributed under the BSD license:

    Copyright 2012 (c) Mihai Bazon <mihai.bazon@gmail.com>
    Parser based on parse-js (http://marijn.haverbeke.nl/parse-js/).

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:

        * Redistributions of source code must retain the above
          copyright notice, this list of conditions and the following
          disclaimer.

        * Redistributions in binary form must reproduce the above
          copyright notice, this list of conditions and the following
          disclaimer in the documentation and/or other materials
          provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
    EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
    PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
    OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
    PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
    PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
    TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
    THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
    SUCH DAMAGE.

 ***********************************************************************/

"use strict";

var KEYWORDS = "break case catch class const continue debugger default delete do else extends finally for function if in instanceof new return switch throw try typeof var void while with";
var KEYWORDS_ATOM = "false null true";
var RESERVED_WORDS = [
    "abstract async await boolean byte char double enum export final float goto implements import int interface let long native package private protected public short static super synchronized this throws transient volatile yield",
    KEYWORDS_ATOM,
    KEYWORDS,
].join(" ");
var KEYWORDS_BEFORE_EXPRESSION = "return new delete throw else case";

KEYWORDS = makePredicate(KEYWORDS);
RESERVED_WORDS = makePredicate(RESERVED_WORDS);
KEYWORDS_BEFORE_EXPRESSION = makePredicate(KEYWORDS_BEFORE_EXPRESSION);
KEYWORDS_ATOM = makePredicate(KEYWORDS_ATOM);

var RE_BIN_NUMBER = /^0b([01]+)$/i;
var RE_HEX_NUMBER = /^0x([0-9a-f]+)$/i;
var RE_OCT_NUMBER = /^0o?([0-7]+)$/i;

var OPERATORS = makePredicate([
    "in",
    "instanceof",
    "typeof",
    "new",
    "void",
    "delete",
    "++",
    "--",
    "+",
    "-",
    "!",
    "~",
    "&",
    "|",
    "^",
    "*",
    "/",
    "%",
    "**",
    ">>",
    "<<",
    ">>>",
    "<",
    ">",
    "<=",
    ">=",
    "==",
    "===",
    "!=",
    "!==",
    "?",
    "=",
    "+=",
    "-=",
    "/=",
    "*=",
    "%=",
    "**=",
    ">>=",
    "<<=",
    ">>>=",
    "&=",
    "|=",
    "^=",
    "&&",
    "||",
    "??",
    "&&=",
    "||=",
    "??=",
]);

var NEWLINE_CHARS = "\n\r\u2028\u2029";
var OPERATOR_CHARS = "+-*&%=<>!?|~^";
var PUNC_OPENERS = "[{(";
var PUNC_SEPARATORS = ",;:";
var PUNC_CLOSERS = ")}]";
var PUNC_AFTER_EXPRESSION = PUNC_SEPARATORS + PUNC_CLOSERS;
var PUNC_BEFORE_EXPRESSION = PUNC_OPENERS + PUNC_SEPARATORS;
var PUNC_CHARS = PUNC_BEFORE_EXPRESSION + "`" + PUNC_CLOSERS;
var WHITESPACE_CHARS = NEWLINE_CHARS + " \u00a0\t\f\u000b\u200b\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\uFEFF";
var NON_IDENTIFIER_CHARS = makePredicate(characters("./'\"#" + OPERATOR_CHARS + PUNC_CHARS + WHITESPACE_CHARS));

NEWLINE_CHARS = makePredicate(characters(NEWLINE_CHARS));
OPERATOR_CHARS = makePredicate(characters(OPERATOR_CHARS));
PUNC_AFTER_EXPRESSION = makePredicate(characters(PUNC_AFTER_EXPRESSION));
PUNC_BEFORE_EXPRESSION = makePredicate(characters(PUNC_BEFORE_EXPRESSION));
PUNC_CHARS = makePredicate(characters(PUNC_CHARS));
WHITESPACE_CHARS = makePredicate(characters(WHITESPACE_CHARS));

/* -----[ Tokenizer ]----- */

function is_surrogate_pair_head(code) {
    return code >= 0xd800 && code <= 0xdbff;
}

function is_surrogate_pair_tail(code) {
    return code >= 0xdc00 && code <= 0xdfff;
}

function is_digit(code) {
    return code >= 48 && code <= 57;
}

function is_identifier_char(ch) {
    return !NON_IDENTIFIER_CHARS[ch];
}

function is_identifier_string(str) {
    return /^[a-z_$][a-z0-9_$]*$/i.test(str);
}

function decode_escape_sequence(seq) {
    switch (seq[0]) {
      case "b": return "\b";
      case "f": return "\f";
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      case "u":
        var code;
        if (seq[1] == "{" && seq.slice(-1) == "}") {
            code = seq.slice(2, -1);
        } else if (seq.length == 5) {
            code = seq.slice(1);
        } else {
            return;
        }
        var num = parseInt(code, 16);
        if (num < 0 || isNaN(num)) return;
        if (num < 0x10000) return String.fromCharCode(num);
        if (num > 0x10ffff) return;
        return String.fromCharCode((num >> 10) + 0xd7c0) + String.fromCharCode((num & 0x03ff) + 0xdc00);
      case "v": return "\u000b";
      case "x":
        if (seq.length != 3) return;
        var num = parseInt(seq.slice(1), 16);
        if (num < 0 || isNaN(num)) return;
        return String.fromCharCode(num);
      case "\r":
      case "\n":
        return "";
      default:
        if (seq == "0") return "\0";
        if (seq[0] >= "0" && seq[0] <= "9") return;
        return seq;
    }
}

function parse_js_number(num) {
    var match;
    if (match = RE_BIN_NUMBER.exec(num)) return parseInt(match[1], 2);
    if (match = RE_HEX_NUMBER.exec(num)) return parseInt(match[1], 16);
    if (match = RE_OCT_NUMBER.exec(num)) return parseInt(match[1], 8);
    var val = parseFloat(num);
    if (val == num) return val;
}

function JS_Parse_Error(message, filename, line, col, pos) {
    this.message = message;
    this.filename = filename;
    this.line = line;
    this.col = col;
    this.pos = pos;
}
JS_Parse_Error.prototype = Object.create(Error.prototype);
JS_Parse_Error.prototype.constructor = JS_Parse_Error;
JS_Parse_Error.prototype.name = "SyntaxError";
configure_error_stack(JS_Parse_Error);

function js_error(message, filename, line, col, pos) {
    throw new JS_Parse_Error(message, filename, line, col, pos);
}

function is_token(token, type, val) {
    return token.type == type && (val == null || token.value == val);
}

var EX_EOF = {};

function tokenizer($TEXT, filename, html5_comments, shebang) {

    var S = {
        text            : $TEXT,
        filename        : filename,
        pos             : 0,
        tokpos          : 0,
        line            : 1,
        tokline         : 0,
        col             : 0,
        tokcol          : 0,
        newline_before  : false,
        regex_allowed   : false,
        comments_before : [],
        directives      : Object.create(null),
        read_template   : with_eof_error("Unterminated template literal", function(strings) {
            var s = "";
            for (;;) {
                var ch = read();
                switch (ch) {
                  case "\\":
                    ch += read();
                    break;
                  case "`":
                    strings.push(s);
                    return;
                  case "$":
                    if (peek() == "{") {
                        next();
                        strings.push(s);
                        S.regex_allowed = true;
                        return true;
                    }
                }
                s += ch;
            }

            function read() {
                var ch = next(true, true);
                return ch == "\r" ? "\n" : ch;
            }
        }),
    };
    var prev_was_dot = false;

    function peek() {
        return S.text.charAt(S.pos);
    }

    function next(signal_eof, in_string) {
        var ch = S.text.charAt(S.pos++);
        if (signal_eof && !ch)
            throw EX_EOF;
        if (NEWLINE_CHARS[ch]) {
            S.col = 0;
            S.line++;
            if (!in_string) S.newline_before = true;
            if (ch == "\r" && peek() == "\n") {
                // treat `\r\n` as `\n`
                S.pos++;
                ch = "\n";
            }
        } else {
            S.col++;
        }
        return ch;
    }

    function forward(i) {
        while (i-- > 0) next();
    }

    function looking_at(str) {
        return S.text.substr(S.pos, str.length) == str;
    }

    function find_eol() {
        var text = S.text;
        for (var i = S.pos; i < S.text.length; ++i) {
            if (NEWLINE_CHARS[text[i]]) return i;
        }
        return -1;
    }

    function find(what, signal_eof) {
        var pos = S.text.indexOf(what, S.pos);
        if (signal_eof && pos == -1) throw EX_EOF;
        return pos;
    }

    function start_token() {
        S.tokline = S.line;
        S.tokcol = S.col;
        S.tokpos = S.pos;
    }

    function token(type, value, is_comment) {
        S.regex_allowed = type == "operator" && !UNARY_POSTFIX[value]
            || type == "keyword" && KEYWORDS_BEFORE_EXPRESSION[value]
            || type == "punc" && PUNC_BEFORE_EXPRESSION[value];
        if (type == "punc" && value == ".") prev_was_dot = true;
        else if (!is_comment) prev_was_dot = false;
        var ret = {
            type    : type,
            value   : value,
            line    : S.tokline,
            col     : S.tokcol,
            pos     : S.tokpos,
            endline : S.line,
            endcol  : S.col,
            endpos  : S.pos,
            nlb     : S.newline_before,
            file    : filename
        };
        if (/^(?:num|string|regexp)$/i.test(type)) {
            ret.raw = $TEXT.substring(ret.pos, ret.endpos);
        }
        if (!is_comment) {
            ret.comments_before = S.comments_before;
            ret.comments_after = S.comments_before = [];
        }
        S.newline_before = false;
        return new AST_Token(ret);
    }

    function skip_whitespace() {
        while (WHITESPACE_CHARS[peek()])
            next();
    }

    function read_while(pred) {
        var ret = "", ch;
        while ((ch = peek()) && pred(ch, ret)) ret += next();
        return ret;
    }

    function parse_error(err) {
        js_error(err, filename, S.tokline, S.tokcol, S.tokpos);
    }

    function is_octal(num) {
        return /^0[0-7_]+$/.test(num);
    }

    function read_num(prefix) {
        var has_e = false, after_e = false, has_x = false, has_dot = prefix == ".";
        var num = read_while(function(ch, str) {
            switch (ch) {
              case "x": case "X":
                return has_x ? false : (has_x = true);
              case "e": case "E":
                return has_x ? true : has_e ? false : (has_e = after_e = true);
              case "+": case "-":
                return after_e;
              case (after_e = false, "."):
                return has_dot || has_e || has_x || is_octal(str) ? false : (has_dot = true);
            }
            return /[_0-9a-dfo]/i.test(ch);
        });
        if (prefix) num = prefix + num;
        if (is_octal(num)) {
            if (next_token.has_directive("use strict")) parse_error("Legacy octal literals are not allowed in strict mode");
        } else {
            num = num.replace(has_x ? /([1-9a-f]|.0)_(?=[0-9a-f])/gi : /([1-9]|.0)_(?=[0-9])/gi, "$1");
        }
        var valid = parse_js_number(num);
        if (isNaN(valid)) parse_error("Invalid syntax: " + num);
        if (has_dot || has_e || peek() != "n") return token("num", valid);
        return token("bigint", num.toLowerCase() + next());
    }

    function read_escaped_char(in_string) {
        var seq = next(true, in_string);
        if (seq >= "0" && seq <= "7") return read_octal_escape_sequence(seq);
        if (seq == "u") {
            var ch = next(true, in_string);
            seq += ch;
            if (ch != "{") {
                seq += next(true, in_string) + next(true, in_string) + next(true, in_string);
            } else do {
                ch = next(true, in_string);
                seq += ch;
            } while (ch != "}");
        } else if (seq == "x") {
            seq += next(true, in_string) + next(true, in_string);
        }
        var str = decode_escape_sequence(seq);
        if (typeof str != "string") parse_error("Invalid escape sequence: \\" + seq);
        return str;
    }

    function read_octal_escape_sequence(ch) {
        // Read
        var p = peek();
        if (p >= "0" && p <= "7") {
            ch += next(true);
            if (ch[0] <= "3" && (p = peek()) >= "0" && p <= "7")
                ch += next(true);
        }

        // Parse
        if (ch === "0") return "\0";
        if (ch.length > 0 && next_token.has_directive("use strict"))
            parse_error("Legacy octal escape sequences are not allowed in strict mode");
        return String.fromCharCode(parseInt(ch, 8));
    }

    var read_string = with_eof_error("Unterminated string constant", function(quote_char) {
        var quote = next(), ret = "";
        for (;;) {
            var ch = next(true, true);
            if (ch == "\\") ch = read_escaped_char(true);
            else if (NEWLINE_CHARS[ch]) parse_error("Unterminated string constant");
            else if (ch == quote) break;
            ret += ch;
        }
        var tok = token("string", ret);
        tok.quote = quote_char;
        return tok;
    });

    function skip_line_comment(type) {
        var regex_allowed = S.regex_allowed;
        var i = find_eol(), ret;
        if (i == -1) {
            ret = S.text.substr(S.pos);
            S.pos = S.text.length;
        } else {
            ret = S.text.substring(S.pos, i);
            S.pos = i;
        }
        S.col = S.tokcol + (S.pos - S.tokpos);
        S.comments_before.push(token(type, ret, true));
        S.regex_allowed = regex_allowed;
        return next_token;
    }

    var skip_multiline_comment = with_eof_error("Unterminated multiline comment", function() {
        var regex_allowed = S.regex_allowed;
        var i = find("*/", true);
        var text = S.text.substring(S.pos, i).replace(/\r\n|\r|\u2028|\u2029/g, "\n");
        // update stream position
        forward(text.length /* doesn't count \r\n as 2 char while S.pos - i does */ + 2);
        S.comments_before.push(token("comment2", text, true));
        S.regex_allowed = regex_allowed;
        return next_token;
    });

    function read_name() {
        var backslash = false, ch, escaped = false, name = peek() == "#" ? next() : "";
        while (ch = peek()) {
            if (!backslash) {
                if (ch == "\\") escaped = backslash = true, next();
                else if (is_identifier_char(ch)) name += next();
                else break;
            } else {
                if (ch != "u") parse_error("Expecting UnicodeEscapeSequence -- uXXXX");
                ch = read_escaped_char();
                if (!is_identifier_char(ch)) parse_error("Unicode char: " + ch.charCodeAt(0) + " is not valid in identifier");
                name += ch;
                backslash = false;
            }
        }
        if (KEYWORDS[name] && escaped) {
            var hex = name.charCodeAt(0).toString(16).toUpperCase();
            name = "\\u" + "0000".substr(hex.length) + hex + name.slice(1);
        }
        return name;
    }

    var read_regexp = with_eof_error("Unterminated regular expression", function(source) {
        var prev_backslash = false, ch, in_class = false;
        while ((ch = next(true))) if (NEWLINE_CHARS[ch]) {
            parse_error("Unexpected line terminator");
        } else if (prev_backslash) {
            source += "\\" + ch;
            prev_backslash = false;
        } else if (ch == "[") {
            in_class = true;
            source += ch;
        } else if (ch == "]" && in_class) {
            in_class = false;
            source += ch;
        } else if (ch == "/" && !in_class) {
            break;
        } else if (ch == "\\") {
            prev_backslash = true;
        } else {
            source += ch;
        }
        var mods = read_name();
        try {
            var regexp = new RegExp(source, mods);
            regexp.raw_source = source;
            return token("regexp", regexp);
        } catch (e) {
            parse_error(e.message);
        }
    });

    function read_operator(prefix) {
        function grow(op) {
            if (!peek()) return op;
            var bigger = op + peek();
            if (OPERATORS[bigger]) {
                next();
                return grow(bigger);
            } else {
                return op;
            }
        }
        return token("operator", grow(prefix || next()));
    }

    function handle_slash() {
        next();
        switch (peek()) {
          case "/":
            next();
            return skip_line_comment("comment1");
          case "*":
            next();
            return skip_multiline_comment();
        }
        return S.regex_allowed ? read_regexp("") : read_operator("/");
    }

    function handle_dot() {
        next();
        if (looking_at("..")) return token("operator", "." + next() + next());
        return is_digit(peek().charCodeAt(0)) ? read_num(".") : token("punc", ".");
    }

    function read_word() {
        var word = read_name();
        if (prev_was_dot) return token("name", word);
        return KEYWORDS_ATOM[word] ? token("atom", word)
            : !KEYWORDS[word] ? token("name", word)
            : OPERATORS[word] ? token("operator", word)
            : token("keyword", word);
    }

    function with_eof_error(eof_error, cont) {
        return function(x) {
            try {
                return cont(x);
            } catch (ex) {
                if (ex === EX_EOF) parse_error(eof_error);
                else throw ex;
            }
        };
    }

    function next_token(force_regexp) {
        if (force_regexp != null)
            return read_regexp(force_regexp);
        if (shebang && S.pos == 0 && looking_at("#!")) {
            start_token();
            forward(2);
            skip_line_comment("comment5");
        }
        for (;;) {
            skip_whitespace();
            start_token();
            if (html5_comments) {
                if (looking_at("<!--")) {
                    forward(4);
                    skip_line_comment("comment3");
                    continue;
                }
                if (looking_at("-->") && S.newline_before) {
                    forward(3);
                    skip_line_comment("comment4");
                    continue;
                }
            }
            var ch = peek();
            if (!ch) return token("eof");
            var code = ch.charCodeAt(0);
            switch (code) {
              case 34: case 39: return read_string(ch);
              case 46: return handle_dot();
              case 47:
                var tok = handle_slash();
                if (tok === next_token) continue;
                return tok;
            }
            if (is_digit(code)) return read_num();
            if (PUNC_CHARS[ch]) return token("punc", next());
            if (looking_at("=>")) return token("punc", next() + next());
            if (OPERATOR_CHARS[ch]) return read_operator();
            if (code == 35 || code == 92 || !NON_IDENTIFIER_CHARS[ch]) return read_word();
            break;
        }
        parse_error("Unexpected character '" + ch + "'");
    }

    next_token.context = function(nc) {
        if (nc) S = nc;
        return S;
    };

    next_token.add_directive = function(directive) {
        S.directives[directive] = true;
    }

    next_token.push_directives_stack = function() {
        S.directives = Object.create(S.directives);
    }

    next_token.pop_directives_stack = function() {
        S.directives = Object.getPrototypeOf(S.directives);
    }

    next_token.has_directive = function(directive) {
        return !!S.directives[directive];
    }

    return next_token;
}

/* -----[ Parser (constants) ]----- */

var UNARY_PREFIX = makePredicate("typeof void delete -- ++ ! ~ - +");

var UNARY_POSTFIX = makePredicate("-- ++");

var ASSIGNMENT = makePredicate("= += -= /= *= %= **= >>= <<= >>>= &= |= ^= &&= ||= ??=");

var PRECEDENCE = function(a, ret) {
    for (var i = 0; i < a.length;) {
        var b = a[i++];
        for (var j = 0; j < b.length; j++) {
            ret[b[j]] = i;
        }
    }
    return ret;
}([
    ["??"],
    ["||"],
    ["&&"],
    ["|"],
    ["^"],
    ["&"],
    ["==", "===", "!=", "!=="],
    ["<", ">", "<=", ">=", "in", "instanceof"],
    [">>", "<<", ">>>"],
    ["+", "-"],
    ["*", "/", "%"],
    ["**"],
], {});

var ATOMIC_START_TOKEN = makePredicate("atom bigint num regexp string");

/* -----[ Parser ]----- */

function parse($TEXT, options) {
    options = defaults(options, {
        bare_returns   : false,
        expression     : false,
        filename       : null,
        html5_comments : true,
        module         : false,
        shebang        : true,
        strict         : false,
        toplevel       : null,
    }, true);

    var S = {
        input         : typeof $TEXT == "string"
                        ? tokenizer($TEXT, options.filename, options.html5_comments, options.shebang)
                        : $TEXT,
        in_async      : false,
        in_directives : true,
        in_funarg     : -1,
        in_function   : 0,
        in_generator  : false,
        in_loop       : 0,
        labels        : [],
        peeked        : null,
        prev          : null,
        token         : null,
    };

    S.token = next();

    function is(type, value) {
        return is_token(S.token, type, value);
    }

    function peek() {
        return S.peeked || (S.peeked = S.input());
    }

    function next() {
        S.prev = S.token;
        if (S.peeked) {
            S.token = S.peeked;
            S.peeked = null;
        } else {
            S.token = S.input();
        }
        S.in_directives = S.in_directives && (
            S.token.type == "string" || is("punc", ";")
        );
        return S.token;
    }

    function prev() {
        return S.prev;
    }

    function croak(msg, line, col, pos) {
        var ctx = S.input.context();
        js_error(msg,
                 ctx.filename,
                 line != null ? line : ctx.tokline,
                 col != null ? col : ctx.tokcol,
                 pos != null ? pos : ctx.tokpos);
    }

    function token_error(token, msg) {
        croak(msg, token.line, token.col);
    }

    function token_to_string(type, value) {
        return type + (value === undefined ? "" : " «" + value + "»");
    }

    function unexpected(token) {
        if (token == null) token = S.token;
        token_error(token, "Unexpected token: " + token_to_string(token.type, token.value));
    }

    function expect_token(type, val) {
        if (is(type, val)) return next();
        token_error(S.token, "Unexpected token: " + token_to_string(S.token.type, S.token.value) + ", expected: " + token_to_string(type, val));
    }

    function expect(punc) {
        return expect_token("punc", punc);
    }

    function has_newline_before(token) {
        return token.nlb || !all(token.comments_before, function(comment) {
            return !comment.nlb;
        });
    }

    function can_insert_semicolon() {
        return !options.strict
            && (is("eof") || is("punc", "}") || has_newline_before(S.token));
    }

    function semicolon(optional) {
        if (is("punc", ";")) next();
        else if (!optional && !can_insert_semicolon()) expect(";");
    }

    function parenthesized() {
        expect("(");
        var exp = expression();
        expect(")");
        return exp;
    }

    function embed_tokens(parser) {
        return function() {
            var start = S.token;
            var expr = parser.apply(null, arguments);
            var end = prev();
            expr.start = start;
            expr.end = end;
            return expr;
        };
    }

    function handle_regexp() {
        if (is("operator", "/") || is("operator", "/=")) {
            S.peeked = null;
            S.token = S.input(S.token.value.substr(1)); // force regexp
        }
    }

    var statement = embed_tokens(function(toplevel) {
        handle_regexp();
        switch (S.token.type) {
          case "string":
            var dir = S.in_directives;
            var body = expression();
            if (dir) {
                if (body instanceof AST_String) {
                    var value = body.start.raw.slice(1, -1);
                    S.input.add_directive(value);
                    body.value = value;
                } else {
                    S.in_directives = dir = false;
                }
            }
            semicolon();
            return dir ? new AST_Directive(body) : new AST_SimpleStatement({ body: body });
          case "num":
          case "bigint":
          case "regexp":
          case "operator":
          case "atom":
            return simple_statement();

          case "name":
            switch (S.token.value) {
              case "async":
                if (is_token(peek(), "keyword", "function")) {
                    next();
                    next();
                    if (!is("operator", "*")) return function_(AST_AsyncDefun);
                    next();
                    return function_(AST_AsyncGeneratorDefun);
                }
                break;
              case "await":
                if (S.in_async) return simple_statement();
                break;
              case "export":
                if (!toplevel && options.module !== "") unexpected();
                next();
                return export_();
              case "import":
                var token = peek();
                if (token.type == "punc" && /^[(.]$/.test(token.value)) break;
                if (!toplevel && options.module !== "") unexpected();
                next();
                return import_();
              case "let":
                if (is_vardefs()) {
                    next();
                    var node = let_();
                    semicolon();
                    return node;
                }
                break;
              case "yield":
                if (S.in_generator) return simple_statement();
                break;
            }
            return is_token(peek(), "punc", ":")
                ? labeled_statement()
                : simple_statement();

          case "punc":
            switch (S.token.value) {
              case "{":
                return new AST_BlockStatement({
                    start : S.token,
                    body  : block_(),
                    end   : prev()
                });
              case "[":
              case "(":
              case "`":
                return simple_statement();
              case ";":
                S.in_directives = false;
                next();
                return new AST_EmptyStatement();
              default:
                unexpected();
            }

          case "keyword":
            switch (S.token.value) {
              case "break":
                next();
                return break_cont(AST_Break);

              case "class":
                next();
                return class_(AST_DefClass);

              case "const":
                next();
                var node = const_();
                semicolon();
                return node;

              case "continue":
                next();
                return break_cont(AST_Continue);

              case "debugger":
                next();
                semicolon();
                return new AST_Debugger();

              case "do":
                next();
                var body = in_loop(statement);
                expect_token("keyword", "while");
                var condition = parenthesized();
                semicolon(true);
                return new AST_Do({
                    body      : body,
                    condition : condition,
                });

              case "while":
                next();
                return new AST_While({
                    condition : parenthesized(),
                    body      : in_loop(statement),
                });

              case "for":
                next();
                return for_();

              case "function":
                next();
                if (!is("operator", "*")) return function_(AST_Defun);
                next();
                return function_(AST_GeneratorDefun);

              case "if":
                next();
                return if_();

              case "return":
                if (S.in_function == 0 && !options.bare_returns)
                    croak("'return' outside of function");
                next();
                var value = null;
                if (is("punc", ";")) {
                    next();
                } else if (!can_insert_semicolon()) {
                    value = expression();
                    semicolon();
                }
                return new AST_Return({ value: value });

              case "switch":
                next();
                return new AST_Switch({
                    expression : parenthesized(),
                    body       : in_loop(switch_body_),
                });

              case "throw":
                next();
                if (has_newline_before(S.token))
                    croak("Illegal newline after 'throw'");
                var value = expression();
                semicolon();
                return new AST_Throw({ value: value });

              case "try":
                next();
                return try_();

              case "var":
                next();
                var node = var_();
                semicolon();
                return node;

              case "with":
                if (S.input.has_directive("use strict")) {
                    croak("Strict mode may not include a with statement");
                }
                next();
                return new AST_With({
                    expression : parenthesized(),
                    body       : statement(),
                });
            }
        }
        unexpected();
    });

    function labeled_statement() {
        var label = as_symbol(AST_Label);
        if (!all(S.labels, function(l) {
            return l.name != label.name;
        })) {
            // ECMA-262, 12.12: An ECMAScript program is considered
            // syntactically incorrect if it contains a
            // LabelledStatement that is enclosed by a
            // LabelledStatement with the same Identifier as label.
            croak("Label " + label.name + " defined twice");
        }
        expect(":");
        S.labels.push(label);
        var stat = statement();
        S.labels.pop();
        if (!(stat instanceof AST_IterationStatement)) {
            // check for `continue` that refers to this label.
            // those should be reported as syntax errors.
            // https://github.com/mishoo/UglifyJS/issues/287
            label.references.forEach(function(ref) {
                if (ref instanceof AST_Continue) {
                    token_error(ref.label.start, "Continue label `" + label.name + "` must refer to IterationStatement");
                }
            });
        }
        return new AST_LabeledStatement({ body: stat, label: label });
    }

    function simple_statement() {
        var body = expression();
        semicolon();
        return new AST_SimpleStatement({ body: body });
    }

    function break_cont(type) {
        var label = null, ldef;
        if (!can_insert_semicolon()) {
            label = as_symbol(AST_LabelRef, true);
        }
        if (label != null) {
            ldef = find_if(function(l) {
                return l.name == label.name;
            }, S.labels);
            if (!ldef) token_error(label.start, "Undefined label " + label.name);
            label.thedef = ldef;
        } else if (S.in_loop == 0) croak(type.TYPE + " not inside a loop or switch");
        semicolon();
        var stat = new type({ label: label });
        if (ldef) ldef.references.push(stat);
        return stat;
    }

    function has_modifier(name, no_nlb) {
        if (!is("name", name)) return;
        var token = peek();
        if (!token) return;
        if (is_token(token, "operator", "=")) return;
        if (token.type == "punc" && /^[(;}]$/.test(token.value)) return;
        if (no_nlb && has_newline_before(token)) return;
        return next();
    }

    function class_(ctor) {
        var was_async = S.in_async;
        var was_gen = S.in_generator;
        S.input.push_directives_stack();
        S.input.add_directive("use strict");
        var name;
        if (ctor === AST_DefClass) {
            name = as_symbol(AST_SymbolDefClass);
        } else {
            name = as_symbol(AST_SymbolClass, true);
        }
        var parent = null;
        if (is("keyword", "extends")) {
            next();
            handle_regexp();
            parent = expr_atom(true);
        }
        expect("{");
        var props = [];
        while (!is("punc", "}")) {
            if (is("punc", ";")) {
                next();
                continue;
            }
            var start = S.token;
            var fixed = !!has_modifier("static");
            var async = has_modifier("async", true);
            if (is("operator", "*")) {
                next();
                var internal = is("name") && /^#/.test(S.token.value);
                var key = as_property_key();
                var gen_start = S.token;
                var gen = function_(async ? AST_AsyncGeneratorFunction : AST_GeneratorFunction);
                gen.start = gen_start;
                gen.end = prev();
                props.push(new AST_ClassMethod({
                    start: start,
                    static: fixed,
                    private: internal,
                    key: key,
                    value: gen,
                    end: prev(),
                }));
                continue;
            }
            if (fixed && is("punc", "{")) {
                props.push(new AST_ClassInit({
                    start: start,
                    value: new AST_ClassInitBlock({
                        start: start,
                        body: block_(),
                        end: prev(),
                    }),
                    end: prev(),
                }));
                continue;
            }
            var internal = is("name") && /^#/.test(S.token.value);
            var key = as_property_key();
            if (is("punc", "(")) {
                var func_start = S.token;
                var func = function_(async ? AST_AsyncFunction : AST_Function);
                func.start = func_start;
                func.end = prev();
                props.push(new AST_ClassMethod({
                    start: start,
                    static: fixed,
                    private: internal,
                    key: key,
                    value: func,
                    end: prev(),
                }));
                continue;
            }
            if (async) unexpected(async);
            var value = null;
            if (is("operator", "=")) {
                next();
                S.in_async = false;
                S.in_generator = false;
                value = maybe_assign();
                S.in_generator = was_gen;
                S.in_async = was_async;
            } else if (!(is("punc", ";") || is("punc", "}"))) {
                var type = null;
                switch (key) {
                  case "get":
                    type = AST_ClassGetter;
                    break;
                  case "set":
                    type = AST_ClassSetter;
                    break;
                }
                if (type) {
                    props.push(new type({
                        start: start,
                        static: fixed,
                        private: is("name") && /^#/.test(S.token.value),
                        key: as_property_key(),
                        value: create_accessor(),
                        end: prev(),
                    }));
                    continue;
                }
            }
            semicolon();
            props.push(new AST_ClassField({
                start: start,
                static: fixed,
                private: internal,
                key: key,
                value: value,
                end: prev(),
            }));
        }
        next();
        S.input.pop_directives_stack();
        S.in_generator = was_gen;
        S.in_async = was_async;
        return new ctor({
            extends: parent,
            name: name,
            properties: props,
        });
    }

    function for_() {
        var await_token = is("name", "await") && next();
        expect("(");
        var init = null;
        if (await_token || !is("punc", ";")) {
            init = is("keyword", "const")
                ? (next(), const_(true))
                : is("name", "let") && is_vardefs()
                ? (next(), let_(true))
                : is("keyword", "var")
                ? (next(), var_(true))
                : expression(true);
            var ctor;
            if (await_token) {
                expect_token("name", "of");
                ctor = AST_ForAwaitOf;
            } else if (is("operator", "in")) {
                next();
                ctor = AST_ForIn;
            } else if (is("name", "of")) {
                next();
                ctor = AST_ForOf;
            }
            if (ctor) {
                if (init instanceof AST_Definitions) {
                    if (init.definitions.length > 1) {
                        token_error(init.start, "Only one variable declaration allowed in for..in/of loop");
                    }
                    if (ctor !== AST_ForIn && init.definitions[0].value) {
                        token_error(init.definitions[0].value.start, "No initializers allowed in for..of loop");
                    }
                } else if (!(is_assignable(init) || (init = to_destructured(init)) instanceof AST_Destructured)) {
                    token_error(init.start, "Invalid left-hand side in for..in/of loop");
                }
                return for_enum(ctor, init);
            }
        }
        return regular_for(init);
    }

    function regular_for(init) {
        expect(";");
        var test = is("punc", ";") ? null : expression();
        expect(";");
        var step = is("punc", ")") ? null : expression();
        expect(")");
        return new AST_For({
            init      : init,
            condition : test,
            step      : step,
            body      : in_loop(statement)
        });
    }

    function for_enum(ctor, init) {
        handle_regexp();
        var obj = expression();
        expect(")");
        return new ctor({
            init   : init,
            object : obj,
            body   : in_loop(statement)
        });
    }

    function to_funarg(node) {
        if (node instanceof AST_Array) {
            var rest = null;
            if (node.elements[node.elements.length - 1] instanceof AST_Spread) {
                rest = to_funarg(node.elements.pop().expression);
            }
            return new AST_DestructuredArray({
                start: node.start,
                elements: node.elements.map(to_funarg),
                rest: rest,
                end: node.end,
            });
        }
        if (node instanceof AST_Assign) return new AST_DefaultValue({
            start: node.start,
            name: to_funarg(node.left),
            value: node.right,
            end: node.end,
        });
        if (node instanceof AST_DefaultValue) {
            node.name = to_funarg(node.name);
            return node;
        }
        if (node instanceof AST_DestructuredArray) {
            node.elements = node.elements.map(to_funarg);
            if (node.rest) node.rest = to_funarg(node.rest);
            return node;
        }
        if (node instanceof AST_DestructuredObject) {
            node.properties.forEach(function(prop) {
                prop.value = to_funarg(prop.value);
            });
            if (node.rest) node.rest = to_funarg(node.rest);
            return node;
        }
        if (node instanceof AST_Hole) return node;
        if (node instanceof AST_Object) {
            var rest = null;
            if (node.properties[node.properties.length - 1] instanceof AST_Spread) {
                rest = to_funarg(node.properties.pop().expression);
            }
            return new AST_DestructuredObject({
                start: node.start,
                properties: node.properties.map(function(prop) {
                    if (!(prop instanceof AST_ObjectKeyVal)) token_error(prop.start, "Invalid destructuring assignment");
                    return new AST_DestructuredKeyVal({
                        start: prop.start,
                        key: prop.key,
                        value: to_funarg(prop.value),
                        end: prop.end,
                    });
                }),
                rest: rest,
                end: node.end,
            });
        }
        if (node instanceof AST_SymbolFunarg) return node;
        if (node instanceof AST_SymbolRef) return new AST_SymbolFunarg(node);
        if (node instanceof AST_Yield) return new AST_SymbolFunarg({
            start: node.start,
            name: "yield",
            end: node.end,
        });
        token_error(node.start, "Invalid arrow parameter");
    }

    function arrow(exprs, start, async) {
        var was_async = S.in_async;
        var was_gen = S.in_generator;
        S.in_async = async;
        S.in_generator = false;
        var was_funarg = S.in_funarg;
        S.in_funarg = S.in_function;
        var argnames = exprs.map(to_funarg);
        var rest = exprs.rest || null;
        if (rest) rest = to_funarg(rest);
        S.in_funarg = was_funarg;
        expect("=>");
        var body, value;
        var loop = S.in_loop;
        var labels = S.labels;
        ++S.in_function;
        S.input.push_directives_stack();
        S.in_loop = 0;
        S.labels = [];
        if (is("punc", "{")) {
            S.in_directives = true;
            body = block_();
            value = null;
        } else {
            body = [];
            handle_regexp();
            value = maybe_assign();
        }
        var is_strict = S.input.has_directive("use strict");
        S.input.pop_directives_stack();
        --S.in_function;
        S.in_loop = loop;
        S.labels = labels;
        S.in_generator = was_gen;
        S.in_async = was_async;
        var node = new (async ? AST_AsyncArrow : AST_Arrow)({
            start: start,
            argnames: argnames,
            rest: rest,
            body: body,
            value: value,
            end: prev(),
        });
        if (is_strict) node.each_argname(strict_verify_symbol);
        return node;
    }

    var function_ = function(ctor) {
        var was_async = S.in_async;
        var was_gen = S.in_generator;
        var name;
        if (/Defun$/.test(ctor.TYPE)) {
            name = as_symbol(AST_SymbolDefun);
            S.in_async = /^Async/.test(ctor.TYPE);
            S.in_generator = /Generator/.test(ctor.TYPE);
        } else {
            S.in_async = /^Async/.test(ctor.TYPE);
            S.in_generator = /Generator/.test(ctor.TYPE);
            name = as_symbol(AST_SymbolLambda, true);
        }
        if (name && ctor !== AST_Accessor && !(name instanceof AST_SymbolDeclaration))
            unexpected(prev());
        expect("(");
        var was_funarg = S.in_funarg;
        S.in_funarg = S.in_function;
        var argnames = expr_list(")", !options.strict, false, function() {
            return maybe_default(AST_SymbolFunarg);
        });
        S.in_funarg = was_funarg;
        var loop = S.in_loop;
        var labels = S.labels;
        ++S.in_function;
        S.in_directives = true;
        S.input.push_directives_stack();
        S.in_loop = 0;
        S.labels = [];
        var body = block_();
        var is_strict = S.input.has_directive("use strict");
        S.input.pop_directives_stack();
        --S.in_function;
        S.in_loop = loop;
        S.labels = labels;
        S.in_generator = was_gen;
        S.in_async = was_async;
        var node = new ctor({
            name: name,
            argnames: argnames,
            rest: argnames.rest || null,
            body: body,
        });
        if (is_strict) {
            if (name) strict_verify_symbol(name);
            node.each_argname(strict_verify_symbol);
        }
        return node;
    };

    function if_() {
        var cond = parenthesized(), body = statement(), alt = null;
        if (is("keyword", "else")) {
            next();
            alt = statement();
        }
        return new AST_If({
            condition   : cond,
            body        : body,
            alternative : alt,
        });
    }

    function is_alias() {
        return is("name") || is("string") || is_identifier_string(S.token.value);
    }

    function make_string(token) {
        return new AST_String({
            start: token,
            quote: token.quote,
            value: token.value,
            end: token,
        });
    }

    function as_path() {
        var path = S.token;
        expect_token("string");
        semicolon();
        return make_string(path);
    }

    function export_() {
        if (is("operator", "*")) {
            var key = S.token;
            var alias = key;
            next();
            if (is("name", "as")) {
                next();
                if (!is_alias()) expect_token("name");
                alias = S.token;
                next();
            }
            expect_token("name", "from");
            return new AST_ExportForeign({
                aliases: [ make_string(alias) ],
                keys: [ make_string(key) ],
                path: as_path(),
            });
        }
        if (is("punc", "{")) {
            next();
            var aliases = [];
            var keys = [];
            while (is_alias()) {
                var key = S.token;
                next();
                keys.push(key);
                if (is("name", "as")) {
                    next();
                    if (!is_alias()) expect_token("name");
                    aliases.push(S.token);
                    next();
                } else {
                    aliases.push(key);
                }
                if (!is("punc", "}")) expect(",");
            }
            expect("}");
            if (is("name", "from")) {
                next();
                return new AST_ExportForeign({
                    aliases: aliases.map(make_string),
                    keys: keys.map(make_string),
                    path: as_path(),
                });
            }
            semicolon();
            return new AST_ExportReferences({
                properties: keys.map(function(token, index) {
                    if (!is_token(token, "name")) token_error(token, "Name expected");
                    var sym = _make_symbol(AST_SymbolExport, token);
                    sym.alias = make_string(aliases[index]);
                    return sym;
                }),
            });
        }
        if (is("keyword", "default")) {
            next();
            var start = S.token;
            var body = export_default_decl();
            if (body) {
                body.start = start;
                body.end = prev();
            } else {
                handle_regexp();
                body = expression();
                semicolon();
            }
            return new AST_ExportDefault({ body: body });
        }
        return new AST_ExportDeclaration({ body: export_decl() });
    }

    function maybe_named(def, expr) {
        if (expr.name) {
            expr = new def(expr);
            expr.name = new (def === AST_DefClass ? AST_SymbolDefClass : AST_SymbolDefun)(expr.name);
        }
        return expr;
    }

    function export_default_decl() {
        if (is("name", "async")) {
            if (!is_token(peek(), "keyword", "function")) return;
            next();
            next();
            if (!is("operator", "*")) return maybe_named(AST_AsyncDefun, function_(AST_AsyncFunction));
            next();
            return maybe_named(AST_AsyncGeneratorDefun, function_(AST_AsyncGeneratorFunction));
        } else if (is("keyword")) switch (S.token.value) {
          case "class":
            next();
            return maybe_named(AST_DefClass, class_(AST_ClassExpression));
          case "function":
            next();
            if (!is("operator", "*")) return maybe_named(AST_Defun, function_(AST_Function));
            next();
            return maybe_named(AST_GeneratorDefun, function_(AST_GeneratorFunction));
        }
    }

    var export_decl = embed_tokens(function() {
        if (is("name")) switch (S.token.value) {
          case "async":
            next();
            expect_token("keyword", "function");
            if (!is("operator", "*")) return function_(AST_AsyncDefun);
            next();
            return function_(AST_AsyncGeneratorDefun);
          case "let":
            next();
            var node = let_();
            semicolon();
            return node;
        } else if (is("keyword")) switch (S.token.value) {
          case "class":
            next();
            return class_(AST_DefClass);
          case "const":
            next();
            var node = const_();
            semicolon();
            return node;
          case "function":
            next();
            if (!is("operator", "*")) return function_(AST_Defun);
            next();
            return function_(AST_GeneratorDefun);
          case "var":
            next();
            var node = var_();
            semicolon();
            return node;
        }
        unexpected();
    });

    function import_() {
        var all = null;
        var def = as_symbol(AST_SymbolImport, true);
        var props = null;
        var cont;
        if (def) {
            def.key = new AST_String({
                start: def.start,
                value: "",
                end: def.end,
            });
            if (cont = is("punc", ",")) next();
        } else {
            cont = !is("string");
        }
        if (cont) {
            if (is("operator", "*")) {
                var key = S.token;
                next();
                expect_token("name", "as");
                all = as_symbol(AST_SymbolImport);
                all.key = make_string(key);
            } else {
                expect("{");
                props = [];
                while (is_alias()) {
                    var alias;
                    if (is_token(peek(), "name", "as")) {
                        var key = S.token;
                        next();
                        next();
                        alias = as_symbol(AST_SymbolImport);
                        alias.key = make_string(key);
                    } else {
                        alias = as_symbol(AST_SymbolImport);
                        alias.key = new AST_String({
                            start: alias.start,
                            value: alias.name,
                            end: alias.end,
                        });
                    }
                    props.push(alias);
                    if (!is("punc", "}")) expect(",");
                }
                expect("}");
            }
        }
        if (all || def || props) expect_token("name", "from");
        return new AST_Import({
            all: all,
            default: def,
            path: as_path(),
            properties: props,
        });
    }

    function block_() {
        expect("{");
        var a = [];
        while (!is("punc", "}")) {
            if (is("eof")) expect("}");
            a.push(statement());
        }
        next();
        return a;
    }

    function switch_body_() {
        expect("{");
        var a = [], branch, cur, default_branch, tmp;
        while (!is("punc", "}")) {
            if (is("eof")) expect("}");
            if (is("keyword", "case")) {
                if (branch) branch.end = prev();
                cur = [];
                branch = new AST_Case({
                    start      : (tmp = S.token, next(), tmp),
                    expression : expression(),
                    body       : cur
                });
                a.push(branch);
                expect(":");
            } else if (is("keyword", "default")) {
                if (branch) branch.end = prev();
                if (default_branch) croak("More than one default clause in switch statement");
                cur = [];
                branch = new AST_Default({
                    start : (tmp = S.token, next(), expect(":"), tmp),
                    body  : cur
                });
                a.push(branch);
                default_branch = branch;
            } else {
                if (!cur) unexpected();
                cur.push(statement());
            }
        }
        if (branch) branch.end = prev();
        next();
        return a;
    }

    function try_() {
        var body = block_(), bcatch = null, bfinally = null;
        if (is("keyword", "catch")) {
            var start = S.token;
            next();
            var name = null;
            if (is("punc", "(")) {
                next();
                name = maybe_destructured(AST_SymbolCatch);
                expect(")");
            }
            bcatch = new AST_Catch({
                start   : start,
                argname : name,
                body    : block_(),
                end     : prev()
            });
        }
        if (is("keyword", "finally")) {
            var start = S.token;
            next();
            bfinally = new AST_Finally({
                start : start,
                body  : block_(),
                end   : prev()
            });
        }
        if (!bcatch && !bfinally)
            croak("Missing catch/finally blocks");
        return new AST_Try({
            body     : body,
            bcatch   : bcatch,
            bfinally : bfinally
        });
    }

    function vardefs(type, no_in) {
        var a = [];
        for (;;) {
            var start = S.token;
            var name = maybe_destructured(type);
            var value = null;
            if (is("operator", "=")) {
                next();
                value = maybe_assign(no_in);
            } else if (!no_in && (type === AST_SymbolConst || name instanceof AST_Destructured)) {
                croak("Missing initializer in declaration");
            }
            a.push(new AST_VarDef({
                start : start,
                name  : name,
                value : value,
                end   : prev()
            }));
            if (!is("punc", ","))
                break;
            next();
        }
        return a;
    }

    function is_vardefs() {
        var token = peek();
        return is_token(token, "name") || is_token(token, "punc", "[") || is_token(token, "punc", "{");
    }

    var const_ = function(no_in) {
        return new AST_Const({
            start       : prev(),
            definitions : vardefs(AST_SymbolConst, no_in),
            end         : prev()
        });
    };

    var let_ = function(no_in) {
        return new AST_Let({
            start       : prev(),
            definitions : vardefs(AST_SymbolLet, no_in),
            end         : prev()
        });
    };

    var var_ = function(no_in) {
        return new AST_Var({
            start       : prev(),
            definitions : vardefs(AST_SymbolVar, no_in),
            end         : prev()
        });
    };

    var new_ = function(allow_calls) {
        var start = S.token;
        expect_token("operator", "new");
        var call;
        if (is("punc", ".") && is_token(peek(), "name", "target")) {
            next();
            next();
            call = new AST_NewTarget();
        } else {
            var exp = expr_atom(false), args;
            if (is("punc", "(")) {
                next();
                args = expr_list(")", !options.strict);
            } else {
                args = [];
            }
            call = new AST_New({ expression: exp, args: args });
        }
        call.start = start;
        call.end = prev();
        return subscripts(call, allow_calls);
    };

    function as_atom_node() {
        var ret, tok = S.token, value = tok.value;
        switch (tok.type) {
          case "num":
            if (isFinite(value)) {
                ret = new AST_Number({ value: value });
            } else {
                ret = new AST_Infinity();
                if (value < 0) ret = new AST_UnaryPrefix({ operator: "-", expression: ret });
            }
            break;
          case "bigint":
            ret = new AST_BigInt({ value: value });
            break;
          case "string":
            ret = new AST_String({ value: value, quote: tok.quote });
            break;
          case "regexp":
            ret = new AST_RegExp({ value: value });
            break;
          case "atom":
            switch (value) {
              case "false":
                ret = new AST_False();
                break;
              case "true":
                ret = new AST_True();
                break;
              case "null":
                ret = new AST_Null();
                break;
              default:
                unexpected();
            }
            break;
          default:
            unexpected();
        }
        next();
        ret.start = ret.end = tok;
        return ret;
    }

    var expr_atom = function(allow_calls) {
        if (is("operator", "new")) {
            return new_(allow_calls);
        }
        var start = S.token;
        if (is("punc")) {
            switch (start.value) {
              case "`":
                return subscripts(template(null), allow_calls);
              case "(":
                next();
                if (is("punc", ")")) {
                    next();
                    return arrow([], start);
                }
                var ex = expression(false, true);
                var len = start.comments_before.length;
                [].unshift.apply(ex.start.comments_before, start.comments_before);
                start.comments_before.length = 0;
                start.comments_before = ex.start.comments_before;
                start.comments_before_length = len;
                if (len == 0 && start.comments_before.length > 0) {
                    var comment = start.comments_before[0];
                    if (!comment.nlb) {
                        comment.nlb = start.nlb;
                        start.nlb = false;
                    }
                }
                start.comments_after = ex.start.comments_after;
                ex.start = start;
                expect(")");
                var end = prev();
                end.comments_before = ex.end.comments_before;
                end.comments_after.forEach(function(comment) {
                    ex.end.comments_after.push(comment);
                    if (comment.nlb) S.token.nlb = true;
                });
                end.comments_after.length = 0;
                end.comments_after = ex.end.comments_after;
                ex.end = end;
                if (is("punc", "=>")) return arrow(ex instanceof AST_Sequence ? ex.expressions : [ ex ], start);
                return subscripts(ex, allow_calls);
              case "[":
                return subscripts(array_(), allow_calls);
              case "{":
                return subscripts(object_(), allow_calls);
            }
            unexpected();
        }
        if (is("keyword")) switch (start.value) {
          case "class":
            next();
            var clazz = class_(AST_ClassExpression);
            clazz.start = start;
            clazz.end = prev();
            return subscripts(clazz, allow_calls);
          case "function":
            next();
            var func;
            if (is("operator", "*")) {
                next();
                func = function_(AST_GeneratorFunction);
            } else {
                func = function_(AST_Function);
            }
            func.start = start;
            func.end = prev();
            return subscripts(func, allow_calls);
        }
        if (is("name")) {
            var sym = _make_symbol(AST_SymbolRef, start);
            next();
            if (sym.name == "async") {
                if (is("keyword", "function")) {
                    next();
                    var func;
                    if (is("operator", "*")) {
                        next();
                        func = function_(AST_AsyncGeneratorFunction);
                    } else {
                        func = function_(AST_AsyncFunction);
                    }
                    func.start = start;
                    func.end = prev();
                    return subscripts(func, allow_calls);
                }
                if (is("name") && is_token(peek(), "punc", "=>")) {
                    start = S.token;
                    sym = _make_symbol(AST_SymbolRef, start);
                    next();
                    return arrow([ sym ], start, true);
                }
                if (is("punc", "(")) {
                    var call = subscripts(sym, allow_calls);
                    if (!is("punc", "=>")) return call;
                    var args = call.args;
                    if (args[args.length - 1] instanceof AST_Spread) {
                        args.rest = args.pop().expression;
                    }
                    return arrow(args, start, true);
                }
            }
            return is("punc", "=>") ? arrow([ sym ], start) : subscripts(sym, allow_calls);
        }
        if (ATOMIC_START_TOKEN[S.token.type]) {
            return subscripts(as_atom_node(), allow_calls);
        }
        unexpected();
    };

    function expr_list(closing, allow_trailing_comma, allow_empty, parser) {
        if (!parser) parser = maybe_assign;
        var first = true, a = [];
        while (!is("punc", closing)) {
            if (first) first = false; else expect(",");
            if (allow_trailing_comma && is("punc", closing)) break;
            if (allow_empty && is("punc", ",")) {
                a.push(new AST_Hole({ start: S.token, end: S.token }));
            } else if (!is("operator", "...")) {
                a.push(parser());
            } else if (parser === maybe_assign) {
                a.push(new AST_Spread({
                    start: S.token,
                    expression: (next(), parser()),
                    end: prev(),
                }));
            } else {
                next();
                a.rest = parser();
                if (a.rest instanceof AST_DefaultValue) token_error(a.rest.start, "Invalid rest parameter");
                break;
            }
        }
        expect(closing);
        return a;
    }

    var array_ = embed_tokens(function() {
        expect("[");
        return new AST_Array({
            elements: expr_list("]", !options.strict, true)
        });
    });

    var create_accessor = embed_tokens(function() {
        return function_(AST_Accessor);
    });

    var object_ = embed_tokens(function() {
        expect("{");
        var first = true, a = [];
        while (!is("punc", "}")) {
            if (first) first = false; else expect(",");
            // allow trailing comma
            if (!options.strict && is("punc", "}")) break;
            var start = S.token;
            if (is("operator", "*")) {
                next();
                var key = as_property_key();
                var gen_start = S.token;
                var gen = function_(AST_GeneratorFunction);
                gen.start = gen_start;
                gen.end = prev();
                a.push(new AST_ObjectMethod({
                    start: start,
                    key: key,
                    value: gen,
                    end: prev(),
                }));
                continue;
            }
            if (is("operator", "...")) {
                next();
                a.push(new AST_Spread({
                    start: start,
                    expression: maybe_assign(),
                    end: prev(),
                }));
                continue;
            }
            if (is_token(peek(), "operator", "=")) {
                var name = as_symbol(AST_SymbolRef);
                next();
                a.push(new AST_ObjectKeyVal({
                    start: start,
                    key: start.value,
                    value: new AST_Assign({
                        start: start,
                        left: name,
                        operator: "=",
                        right: maybe_assign(),
                        end: prev(),
                    }),
                    end: prev(),
                }));
                continue;
            }
            if (is_token(peek(), "punc", ",") || is_token(peek(), "punc", "}")) {
                a.push(new AST_ObjectKeyVal({
                    start: start,
                    key: start.value,
                    value: as_symbol(AST_SymbolRef),
                    end: prev(),
                }));
                continue;
            }
            var key = as_property_key();
            if (is("punc", "(")) {
                var func_start = S.token;
                var func = function_(AST_Function);
                func.start = func_start;
                func.end = prev();
                a.push(new AST_ObjectMethod({
                    start: start,
                    key: key,
                    value: func,
                    end: prev(),
                }));
                continue;
            }
            if (is("punc", ":")) {
                next();
                a.push(new AST_ObjectKeyVal({
                    start: start,
                    key: key,
                    value: maybe_assign(),
                    end: prev(),
                }));
                continue;
            }
            if (start.type == "name") switch (key) {
              case "async":
                var is_gen = is("operator", "*") && next();
                key = as_property_key();
                var func_start = S.token;
                var func = function_(is_gen ? AST_AsyncGeneratorFunction : AST_AsyncFunction);
                func.start = func_start;
                func.end = prev();
                a.push(new AST_ObjectMethod({
                    start: start,
                    key: key,
                    value: func,
                    end: prev(),
                }));
                continue;
              case "get":
                a.push(new AST_ObjectGetter({
                    start: start,
                    key: as_property_key(),
                    value: create_accessor(),
                    end: prev(),
                }));
                continue;
              case "set":
                a.push(new AST_ObjectSetter({
                    start: start,
                    key: as_property_key(),
                    value: create_accessor(),
                    end: prev(),
                }));
                continue;
            }
            unexpected();
        }
        next();
        return new AST_Object({ properties: a });
    });

    function as_property_key() {
        var tmp = S.token;
        switch (tmp.type) {
          case "operator":
            if (!KEYWORDS[tmp.value]) unexpected();
          case "num":
          case "string":
          case "name":
          case "keyword":
          case "atom":
            next();
            return "" + tmp.value;
          case "punc":
            expect("[");
            var key = maybe_assign();
            expect("]");
            return key;
          default:
            unexpected();
        }
    }

    function as_name() {
        var name = S.token.value;
        expect_token("name");
        return name;
    }

    function _make_symbol(type, token) {
        var name = token.value;
        switch (name) {
          case "await":
            if (S.in_async) unexpected(token);
            break;
          case "super":
            type = AST_Super;
            break;
          case "this":
            type = AST_This;
            break;
          case "yield":
            if (S.in_generator) unexpected(token);
            break;
        }
        return new type({
            name: "" + name,
            start: token,
            end: token,
        });
    }

    function strict_verify_symbol(sym) {
        if (sym.name == "arguments" || sym.name == "eval" || sym.name == "let")
            token_error(sym.start, "Unexpected " + sym.name + " in strict mode");
    }

    function as_symbol(type, no_error) {
        if (!is("name")) {
            if (!no_error) croak("Name expected");
            return null;
        }
        var sym = _make_symbol(type, S.token);
        if (S.input.has_directive("use strict") && sym instanceof AST_SymbolDeclaration) {
            strict_verify_symbol(sym);
        }
        next();
        return sym;
    }

    function maybe_destructured(type) {
        var start = S.token;
        if (is("punc", "[")) {
            next();
            var elements = expr_list("]", !options.strict, true, function() {
                return maybe_default(type);
            });
            return new AST_DestructuredArray({
                start: start,
                elements: elements,
                rest: elements.rest || null,
                end: prev(),
            });
        }
        if (is("punc", "{")) {
            next();
            var first = true, a = [], rest = null;
            while (!is("punc", "}")) {
                if (first) first = false; else expect(",");
                // allow trailing comma
                if (!options.strict && is("punc", "}")) break;
                var key_start = S.token;
                if (is("punc", "[") || is_token(peek(), "punc", ":")) {
                    var key = as_property_key();
                    expect(":");
                    a.push(new AST_DestructuredKeyVal({
                        start: key_start,
                        key: key,
                        value: maybe_default(type),
                        end: prev(),
                    }));
                    continue;
                }
                if (is("operator", "...")) {
                    next();
                    rest = maybe_destructured(type);
                    break;
                }
                var name = as_symbol(type);
                if (is("operator", "=")) {
                    next();
                    name = new AST_DefaultValue({
                        start: name.start,
                        name: name,
                        value: maybe_assign(),
                        end: prev(),
                    });
                }
                a.push(new AST_DestructuredKeyVal({
                    start: key_start,
                    key: key_start.value,
                    value: name,
                    end: prev(),
                }));
            }
            expect("}");
            return new AST_DestructuredObject({
                start: start,
                properties: a,
                rest: rest,
                end: prev(),
            });
        }
        return as_symbol(type);
    }

    function maybe_default(type) {
        var start = S.token;
        var name = maybe_destructured(type);
        if (!is("operator", "=")) return name;
        next();
        return new AST_DefaultValue({
            start: start,
            name: name,
            value: maybe_assign(),
            end: prev(),
        });
    }

    function template(tag) {
        var start = tag ? tag.start : S.token;
        var read = S.input.context().read_template;
        var strings = [];
        var expressions = [];
        while (read(strings)) {
            next();
            expressions.push(expression());
            if (!is("punc", "}")) unexpected();
        }
        next();
        return new AST_Template({
            start: start,
            expressions: expressions,
            strings: strings,
            tag: tag,
            end: prev(),
        });
    }

    function subscripts(expr, allow_calls) {
        var start = expr.start;
        var optional = null;
        while (true) {
            if (is("operator", "?") && is_token(peek(), "punc", ".")) {
                next();
                next();
                optional = expr;
            }
            if (is("punc", "[")) {
                next();
                var prop = expression();
                expect("]");
                expr = new AST_Sub({
                    start: start,
                    optional: optional === expr,
                    expression: expr,
                    property: prop,
                    end: prev(),
                });
            } else if (allow_calls && is("punc", "(")) {
                next();
                expr = new AST_Call({
                    start: start,
                    optional: optional === expr,
                    expression: expr,
                    args: expr_list(")", !options.strict),
                    end: prev(),
                });
            } else if (optional === expr || is("punc", ".")) {
                if (optional !== expr) next();
                expr = new AST_Dot({
                    start: start,
                    optional: optional === expr,
                    expression: expr,
                    property: as_name(),
                    end: prev(),
                });
            } else if (is("punc", "`")) {
                if (optional) croak("Invalid template on optional chain");
                expr = template(expr);
            } else {
                break;
            }
        }
        if (optional) expr.terminal = true;
        if (expr instanceof AST_Call && !expr.pure) {
            var start = expr.start;
            var comments = start.comments_before;
            var i = HOP(start, "comments_before_length") ? start.comments_before_length : comments.length;
            while (--i >= 0) {
                if (/[@#]__PURE__/.test(comments[i].value)) {
                    expr.pure = true;
                    break;
                }
            }
        }
        return expr;
    }

    function maybe_unary(no_in) {
        var start = S.token;
        if (S.in_async && is("name", "await")) {
            if (S.in_funarg === S.in_function) croak("Invalid use of await in function argument");
            S.input.context().regex_allowed = true;
            next();
            return new AST_Await({
                start: start,
                expression: maybe_unary(no_in),
                end: prev(),
            });
        }
        if (S.in_generator && is("name", "yield")) {
            if (S.in_funarg === S.in_function) croak("Invalid use of yield in function argument");
            S.input.context().regex_allowed = true;
            next();
            var exp = null;
            var nested = false;
            if (is("operator", "*")) {
                next();
                exp = maybe_assign(no_in);
                nested = true;
            } else if (is("punc") ? !PUNC_AFTER_EXPRESSION[S.token.value] : !can_insert_semicolon()) {
                exp = maybe_assign(no_in);
            }
            return new AST_Yield({
                start: start,
                expression: exp,
                nested: nested,
                end: prev(),
            });
        }
        if (is("operator") && UNARY_PREFIX[start.value]) {
            next();
            handle_regexp();
            var ex = make_unary(AST_UnaryPrefix, start, maybe_unary(no_in));
            ex.start = start;
            ex.end = prev();
            return ex;
        }
        var val = expr_atom(true);
        while (is("operator") && UNARY_POSTFIX[S.token.value] && !has_newline_before(S.token)) {
            val = make_unary(AST_UnaryPostfix, S.token, val);
            val.start = start;
            val.end = S.token;
            next();
        }
        return val;
    }

    function make_unary(ctor, token, expr) {
        var op = token.value;
        switch (op) {
          case "++":
          case "--":
            if (!is_assignable(expr))
                token_error(token, "Invalid use of " + op + " operator");
            break;
          case "delete":
            if (expr instanceof AST_SymbolRef && S.input.has_directive("use strict"))
                token_error(expr.start, "Calling delete on expression not allowed in strict mode");
            break;
        }
        return new ctor({ operator: op, expression: expr });
    }

    var expr_op = function(left, min_precision, no_in) {
        var op = is("operator") ? S.token.value : null;
        if (op == "in" && no_in) op = null;
        var precision = op != null ? PRECEDENCE[op] : null;
        if (precision != null && precision > min_precision) {
            next();
            var right = expr_op(maybe_unary(no_in), op == "**" ? precision - 1 : precision, no_in);
            return expr_op(new AST_Binary({
                start    : left.start,
                left     : left,
                operator : op,
                right    : right,
                end      : right.end,
            }), min_precision, no_in);
        }
        return left;
    };

    function expr_ops(no_in) {
        return expr_op(maybe_unary(no_in), 0, no_in);
    }

    var maybe_conditional = function(no_in) {
        var start = S.token;
        var expr = expr_ops(no_in);
        if (is("operator", "?")) {
            next();
            var yes = maybe_assign();
            expect(":");
            return new AST_Conditional({
                start       : start,
                condition   : expr,
                consequent  : yes,
                alternative : maybe_assign(no_in),
                end         : prev()
            });
        }
        return expr;
    };

    function is_assignable(expr) {
        return expr instanceof AST_PropAccess && !expr.optional || expr instanceof AST_SymbolRef;
    }

    function to_destructured(node) {
        if (node instanceof AST_Array) {
            var rest = null;
            if (node.elements[node.elements.length - 1] instanceof AST_Spread) {
                rest = to_destructured(node.elements.pop().expression);
                if (!(rest instanceof AST_Destructured || is_assignable(rest))) return node;
            }
            var elements = node.elements.map(to_destructured);
            return all(elements, function(node) {
                return node instanceof AST_DefaultValue
                    || node instanceof AST_Destructured
                    || node instanceof AST_Hole
                    || is_assignable(node);
            }) ? new AST_DestructuredArray({
                start: node.start,
                elements: elements,
                rest: rest,
                end: node.end,
            }) : node;
        }
        if (node instanceof AST_Assign) {
            var name = to_destructured(node.left);
            return name instanceof AST_Destructured || is_assignable(name) ? new AST_DefaultValue({
                start: node.start,
                name: name,
                value: node.right,
                end: node.end,
            }) : node;
        }
        if (!(node instanceof AST_Object)) return node;
        var rest = null;
        if (node.properties[node.properties.length - 1] instanceof AST_Spread) {
            rest = to_destructured(node.properties.pop().expression);
            if (!(rest instanceof AST_Destructured || is_assignable(rest))) return node;
        }
        var props = [];
        for (var i = 0; i < node.properties.length; i++) {
            var prop = node.properties[i];
            if (!(prop instanceof AST_ObjectKeyVal)) return node;
            var value = to_destructured(prop.value);
            if (!(value instanceof AST_DefaultValue || value instanceof AST_Destructured || is_assignable(value))) {
                return node;
            }
            props.push(new AST_DestructuredKeyVal({
                start: prop.start,
                key: prop.key,
                value: value,
                end: prop.end,
            }));
        }
        return new AST_DestructuredObject({
            start: node.start,
            properties: props,
            rest: rest,
            end: node.end,
        });
    }

    function maybe_assign(no_in) {
        var start = S.token;
        var left = maybe_conditional(no_in), val = S.token.value;
        if (is("operator") && ASSIGNMENT[val]) {
            if (is_assignable(left) || val == "=" && (left = to_destructured(left)) instanceof AST_Destructured) {
                next();
                return new AST_Assign({
                    start    : start,
                    left     : left,
                    operator : val,
                    right    : maybe_assign(no_in),
                    end      : prev()
                });
            }
            croak("Invalid assignment");
        }
        return left;
    }

    function expression(no_in, maybe_arrow) {
        var start = S.token;
        var exprs = [];
        while (true) {
            if (maybe_arrow && is("operator", "...")) {
                next();
                exprs.rest = maybe_destructured(AST_SymbolFunarg);
                break;
            }
            exprs.push(maybe_assign(no_in));
            if (!is("punc", ",")) break;
            next();
            if (maybe_arrow && is("punc", ")") && is_token(peek(), "punc", "=>")) break;
        }
        return exprs.length == 1 && !exprs.rest ? exprs[0] : new AST_Sequence({
            start: start,
            expressions: exprs,
            end: prev(),
        });
    }

    function in_loop(cont) {
        ++S.in_loop;
        var ret = cont();
        --S.in_loop;
        return ret;
    }

    if (options.expression) {
        handle_regexp();
        var exp = expression();
        expect_token("eof");
        return exp;
    }

    return function() {
        var start = S.token;
        var body = [];
        if (options.module) {
            S.in_async = true;
            S.input.add_directive("use strict");
        }
        S.input.push_directives_stack();
        while (!is("eof"))
            body.push(statement(true));
        S.input.pop_directives_stack();
        var end = prev() || start;
        var toplevel = options.toplevel;
        if (toplevel) {
            toplevel.body = toplevel.body.concat(body);
            toplevel.end = end;
        } else {
            toplevel = new AST_Toplevel({ start: start, body: body, end: end });
        }
        return toplevel;
    }();
}


/***********************************************************************

  A JavaScript tokenizer / parser / beautifier / compressor.
  https://github.com/mishoo/UglifyJS

  -------------------------------- (C) ---------------------------------

                           Author: Mihai Bazon
                         <mihai.bazon@gmail.com>
                       http://mihai.bazon.net/blog

  Distributed under the BSD license:

    Copyright 2012 (c) Mihai Bazon <mihai.bazon@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:

        * Redistributions of source code must retain the above
          copyright notice, this list of conditions and the following
          disclaimer.

        * Redistributions in binary form must reproduce the above
          copyright notice, this list of conditions and the following
          disclaimer in the documentation and/or other materials
          provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
    EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
    PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
    OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
    PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
    PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
    TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
    THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
    SUCH DAMAGE.

 ***********************************************************************/

"use strict";

function SymbolDef(id, scope, orig, init) {
    this._bits = 0;
    this.defun = undefined;
    this.eliminated = 0;
    this.id = id;
    this.init = init;
    this.mangled_name = null;
    this.name = orig.name;
    this.orig = [ orig ];
    this.references = [];
    this.replaced = 0;
    this.safe_ids = undefined;
    this.scope = scope;
}

SymbolDef.prototype = {
    forEach: function(fn) {
        this.orig.forEach(fn);
        this.references.forEach(fn);
    },
    mangle: function(options) {
        if (this.mangled_name) return;
        var cache = this.global && options.cache && options.cache.props;
        if (cache && cache.has(this.name)) {
            this.mangled_name = cache.get(this.name);
        } else if (this.unmangleable(options)) {
            names_in_use(this.scope, options).set(this.name, true);
        } else {
            var def = this.redefined();
            if (def) {
                this.mangled_name = def.mangled_name || def.name;
            } else {
                this.mangled_name = next_mangled_name(this, options);
            }
            if (cache) cache.set(this.name, this.mangled_name);
        }
    },
    redefined: function() {
        var self = this;
        var scope = self.defun;
        if (!scope) return;
        var name = self.name;
        var def = scope.variables.get(name)
            || scope instanceof AST_Toplevel && scope.globals.get(name)
            || self.orig[0] instanceof AST_SymbolConst && find_if(function(def) {
                return def.name == name;
            }, scope.enclosed);
        if (def && def !== self) return def.redefined() || def;
    },
    unmangleable: function(options) {
        if (this.exported) return true;
        if (this.undeclared) return true;
        if (!options.eval && this.scope.pinned()) return true;
        if (options.keep_fargs && is_funarg(this)) return true;
        if (options.keep_fnames) {
            var sym = this.orig[0];
            if (sym instanceof AST_SymbolClass) return true;
            if (sym instanceof AST_SymbolDefClass) return true;
            if (sym instanceof AST_SymbolDefun) return true;
            if (sym instanceof AST_SymbolLambda) return true;
        }
        if (!options.toplevel && this.global) return true;
        return false;
    },
};

DEF_BITPROPS(SymbolDef, [
    "const_redefs",
    "cross_loop",
    "direct_access",
    "exported",
    "global",
    "undeclared",
]);

function is_funarg(def) {
    return def.orig[0] instanceof AST_SymbolFunarg || def.orig[1] instanceof AST_SymbolFunarg;
}

var unary_side_effects = makePredicate("delete ++ --");

function is_lhs(node, parent) {
    if (parent instanceof AST_Assign) return parent.left === node && node;
    if (parent instanceof AST_DefaultValue) return parent.name === node && node;
    if (parent instanceof AST_Destructured) return node;
    if (parent instanceof AST_DestructuredKeyVal) return node;
    if (parent instanceof AST_ForEnumeration) return parent.init === node && node;
    if (parent instanceof AST_Unary) return unary_side_effects[parent.operator] && parent.expression;
}

AST_Toplevel.DEFMETHOD("figure_out_scope", function(options) {
    options = defaults(options, {
        cache: null,
        ie: false,
    });

    // pass 1: setup scope chaining and handle definitions
    var self = this;
    var defun = null;
    var exported = false;
    var next_def_id = 0;
    var scope = self.parent_scope = null;
    var tw = new TreeWalker(function(node, descend) {
        if (node instanceof AST_DefClass) {
            var save_exported = exported;
            exported = tw.parent() instanceof AST_ExportDeclaration;
            node.name.walk(tw);
            exported = save_exported;
            walk_scope(function() {
                if (node.extends) node.extends.walk(tw);
                node.properties.forEach(function(prop) {
                    prop.walk(tw);
                });
            });
            return true;
        }
        if (node instanceof AST_Definitions) {
            var save_exported = exported;
            exported = tw.parent() instanceof AST_ExportDeclaration;
            descend();
            exported = save_exported;
            return true;
        }
        if (node instanceof AST_LambdaDefinition) {
            var save_exported = exported;
            exported = tw.parent() instanceof AST_ExportDeclaration;
            node.name.walk(tw);
            exported = save_exported;
            walk_scope(function() {
                node.argnames.forEach(function(argname) {
                    argname.walk(tw);
                });
                if (node.rest) node.rest.walk(tw);
                walk_body(node, tw);
            });
            return true;
        }
        if (node instanceof AST_SwitchBranch) {
            node.init_vars(scope);
            descend();
            return true;
        }
        if (node instanceof AST_Try) {
            walk_scope(function() {
                walk_body(node, tw);
            });
            if (node.bcatch) node.bcatch.walk(tw);
            if (node.bfinally) node.bfinally.walk(tw);
            return true;
        }
        if (node instanceof AST_With) {
            var s = scope;
            do {
                s = s.resolve();
                if (s.uses_with) break;
                s.uses_with = true;
            } while (s = s.parent_scope);
            walk_scope(descend);
            return true;
        }
        if (node instanceof AST_BlockScope) {
            walk_scope(descend);
            return true;
        }
        if (node instanceof AST_Symbol) {
            node.scope = scope;
        }
        if (node instanceof AST_Label) {
            node.thedef = node;
            node.references = [];
        }
        if (node instanceof AST_SymbolCatch) {
            scope.def_variable(node).defun = defun;
        } else if (node instanceof AST_SymbolConst) {
            var def = scope.def_variable(node);
            def.defun = defun;
            if (exported) def.exported = true;
        } else if (node instanceof AST_SymbolDefun) {
            var def = defun.def_function(node, tw.parent());
            if (exported) def.exported = true;
        } else if (node instanceof AST_SymbolFunarg) {
            defun.def_variable(node);
        } else if (node instanceof AST_SymbolLambda) {
            var def = defun.def_function(node, node.name == "arguments" ? undefined : defun);
            if (options.ie && node.name != "arguments") def.defun = defun.parent_scope.resolve();
        } else if (node instanceof AST_SymbolLet) {
            var def = scope.def_variable(node);
            if (exported) def.exported = true;
        } else if (node instanceof AST_SymbolVar) {
            var def = defun.def_variable(node, node instanceof AST_SymbolImport ? undefined : null);
            if (exported) def.exported = true;
        }

        function walk_scope(descend) {
            node.init_vars(scope);
            var save_defun = defun;
            var save_scope = scope;
            if (node instanceof AST_Scope) defun = node;
            scope = node;
            descend();
            scope = save_scope;
            defun = save_defun;
        }
    });
    self.make_def = function(orig, init) {
        return new SymbolDef(++next_def_id, this, orig, init);
    };
    self.walk(tw);

    // pass 2: find back references and eval
    self.globals = new Dictionary();
    var in_arg = [];
    var tw = new TreeWalker(function(node) {
        if (node instanceof AST_Catch) {
            if (!(node.argname instanceof AST_Destructured)) return;
            in_arg.push(node);
            node.argname.walk(tw);
            in_arg.pop();
            walk_body(node, tw);
            return true;
        }
        if (node instanceof AST_Lambda) {
            in_arg.push(node);
            if (node.name) node.name.walk(tw);
            node.argnames.forEach(function(argname) {
                argname.walk(tw);
            });
            if (node.rest) node.rest.walk(tw);
            in_arg.pop();
            walk_lambda(node, tw);
            return true;
        }
        if (node instanceof AST_LoopControl) {
            if (node.label) node.label.thedef.references.push(node);
            return true;
        }
        if (node instanceof AST_SymbolDeclaration) {
            var def = node.definition();
            def.preinit = def.references.length;
            if (node instanceof AST_SymbolCatch) {
                // ensure mangling works if `catch` reuses a scope variable
                var redef = def.redefined();
                if (redef) for (var s = node.scope; s; s = s.parent_scope) {
                    if (!push_uniq(s.enclosed, redef)) break;
                    if (s === redef.scope) break;
                }
            } else if (node instanceof AST_SymbolConst) {
                // ensure compression works if `const` reuses a scope variable
                var redef = def.redefined();
                if (redef) redef.const_redefs = true;
            } else if (def.scope !== node.scope && (node instanceof AST_SymbolDefun
                || node instanceof AST_SymbolFunarg
                || node instanceof AST_SymbolVar)) {
                node.mark_enclosed(options);
                var redef = node.scope.find_variable(node.name);
                if (node.thedef !== redef) {
                    node.thedef = redef;
                    redef.orig.push(node);
                    node.mark_enclosed(options);
                }
            }
            if (node.name != "arguments") return true;
            var parent = node instanceof AST_SymbolVar && tw.parent();
            if (parent instanceof AST_VarDef && !parent.value) return true;
            var sym = node.scope.resolve().find_variable("arguments");
            if (sym && is_arguments(sym)) sym.scope.uses_arguments = 3;
            return true;
        }
        if (node instanceof AST_SymbolRef) {
            var name = node.name;
            var sym = node.scope.find_variable(name);
            for (var i = in_arg.length; i > 0 && sym;) {
                i = in_arg.lastIndexOf(sym.scope, i - 1);
                if (i < 0) break;
                var decl = sym.orig[0];
                if (decl instanceof AST_SymbolCatch
                    || decl instanceof AST_SymbolFunarg
                    || decl instanceof AST_SymbolLambda) {
                    node.in_arg = true;
                    break;
                }
                sym = sym.scope.parent_scope.find_variable(name);
            }
            if (!sym) {
                sym = self.def_global(node);
            } else if (name == "arguments" && is_arguments(sym)) {
                var parent = tw.parent();
                if (is_lhs(node, parent)) {
                    sym.scope.uses_arguments = 3;
                } else if (sym.scope.uses_arguments < 2
                    && !(parent instanceof AST_PropAccess && parent.expression === node)) {
                    sym.scope.uses_arguments = 2;
                } else if (!sym.scope.uses_arguments) {
                    sym.scope.uses_arguments = true;
                }
            }
            if (name == "eval") {
                var parent = tw.parent();
                if (parent.TYPE == "Call" && parent.expression === node) {
                    var s = node.scope;
                    do {
                        s = s.resolve();
                        if (s.uses_eval) break;
                        s.uses_eval = true;
                    } while (s = s.parent_scope);
                } else if (sym.undeclared) {
                    self.uses_eval = true;
                }
            }
            if (sym.init instanceof AST_LambdaDefinition && sym.scope !== sym.init.name.scope) {
                var scope = node.scope;
                do {
                    if (scope === sym.init.name.scope) break;
                } while (scope = scope.parent_scope);
                if (!scope) sym.init = undefined;
            }
            node.thedef = sym;
            node.reference(options);
            return true;
        }
    });
    self.walk(tw);

    // pass 3: fix up any scoping issue with IE8
    if (options.ie) self.walk(new TreeWalker(function(node) {
        if (node instanceof AST_SymbolCatch) {
            var def = node.thedef;
            var scope = def.defun;
            if (def.name != "arguments" && scope.name instanceof AST_SymbolLambda && scope.name.name == def.name) {
                scope = scope.parent_scope.resolve();
            }
            redefine(node, scope);
            return true;
        }
        if (node instanceof AST_SymbolLambda) {
            var def = node.thedef;
            if (!redefine(node, node.scope.parent_scope.resolve())) {
                def.defun = undefined;
            } else if (typeof node.thedef.init !== "undefined") {
                node.thedef.init = false;
            } else if (def.init) {
                node.thedef.init = def.init;
            }
            return true;
        }
    }));

    function is_arguments(sym) {
        return sym.orig[0] instanceof AST_SymbolFunarg
            && !(sym.orig[1] instanceof AST_SymbolFunarg || sym.orig[2] instanceof AST_SymbolFunarg)
            && !is_arrow(sym.scope);
    }

    function redefine(node, scope) {
        var name = node.name;
        var old_def = node.thedef;
        if (!all(old_def.orig, function(sym) {
            return !(sym instanceof AST_SymbolConst || sym instanceof AST_SymbolLet);
        })) return false;
        var new_def = scope.find_variable(name);
        if (new_def) {
            var redef = new_def.redefined();
            if (redef) new_def = redef;
        } else {
            new_def = self.globals.get(name);
        }
        if (new_def) {
            new_def.orig.push(node);
        } else {
            new_def = scope.def_variable(node);
        }
        if (new_def.undeclared) self.variables.set(name, new_def);
        if (name == "arguments" && is_arguments(old_def) && node instanceof AST_SymbolLambda) return true;
        old_def.defun = new_def.scope;
        old_def.forEach(function(node) {
            node.redef = old_def;
            node.thedef = new_def;
            node.reference(options);
        });
        return true;
    }
});

AST_Toplevel.DEFMETHOD("def_global", function(node) {
    var globals = this.globals, name = node.name;
    if (globals.has(name)) {
        return globals.get(name);
    } else {
        var g = this.make_def(node);
        g.undeclared = true;
        g.global = true;
        globals.set(name, g);
        return g;
    }
});

function init_block_vars(scope, parent) {
    scope.enclosed = [];                            // variables from this or outer scope(s) that are referenced from this or inner scopes
    scope.parent_scope = parent;                    // the parent scope (null if this is the top level)
    scope.functions = new Dictionary();             // map name to AST_SymbolDefun (functions defined in this scope)
    scope.variables = new Dictionary();             // map name to AST_SymbolVar (variables defined in this scope; includes functions)
    if (parent) scope.make_def = parent.make_def;   // top-level tracking of SymbolDef instances
}

function init_scope_vars(scope, parent) {
    init_block_vars(scope, parent);
    scope.uses_eval = false;                        // will be set to true if this or nested scope uses the global `eval`
    scope.uses_with = false;                        // will be set to true if this or some nested scope uses the `with` statement
}

AST_BlockScope.DEFMETHOD("init_vars", function(parent_scope) {
    init_block_vars(this, parent_scope);
});
AST_Scope.DEFMETHOD("init_vars", function(parent_scope) {
    init_scope_vars(this, parent_scope);
});
AST_Arrow.DEFMETHOD("init_vars", function(parent_scope) {
    init_scope_vars(this, parent_scope);
    return this;
});
AST_AsyncArrow.DEFMETHOD("init_vars", function(parent_scope) {
    init_scope_vars(this, parent_scope);
});
AST_Lambda.DEFMETHOD("init_vars", function(parent_scope) {
    init_scope_vars(this, parent_scope);
    this.uses_arguments = false;
    this.def_variable(new AST_SymbolFunarg({
        name: "arguments",
        scope: this,
        start: this.start,
        end: this.end,
    }));
    return this;
});

AST_Symbol.DEFMETHOD("mark_enclosed", function(options) {
    var def = this.definition();
    for (var s = this.scope; s; s = s.parent_scope) {
        if (!push_uniq(s.enclosed, def)) break;
        if (!options) {
            s._var_names = undefined;
        } else {
            if (options.keep_fargs && s instanceof AST_Lambda) s.each_argname(function(arg) {
                push_uniq(def.scope.enclosed, arg.definition());
            });
            if (options.keep_fnames) s.functions.each(function(d) {
                push_uniq(def.scope.enclosed, d);
            });
        }
        if (s === def.scope) break;
    }
});

AST_Symbol.DEFMETHOD("reference", function(options) {
    this.definition().references.push(this);
    this.mark_enclosed(options);
});

AST_BlockScope.DEFMETHOD("find_variable", function(name) {
    return this.variables.get(name)
        || this.parent_scope && this.parent_scope.find_variable(name);
});

AST_BlockScope.DEFMETHOD("def_function", function(symbol, init) {
    var def = this.def_variable(symbol, init);
    if (!def.init || def.init instanceof AST_LambdaDefinition) def.init = init;
    this.functions.set(symbol.name, def);
    return def;
});

AST_BlockScope.DEFMETHOD("def_variable", function(symbol, init) {
    var def = this.variables.get(symbol.name);
    if (def) {
        def.orig.push(symbol);
        if (def.init instanceof AST_LambdaExpression) def.init = init;
    } else {
        def = this.make_def(symbol, init);
        this.variables.set(symbol.name, def);
        def.global = !this.parent_scope;
    }
    return symbol.thedef = def;
});

function names_in_use(scope, options) {
    var names = scope.names_in_use;
    if (!names) {
        scope.cname = -1;
        scope.cname_holes = [];
        scope.names_in_use = names = new Dictionary();
        var cache = options.cache && options.cache.props;
        scope.enclosed.forEach(function(def) {
            if (def.unmangleable(options)) names.set(def.name, true);
            if (def.global && cache && cache.has(def.name)) {
                names.set(cache.get(def.name), true);
            }
        });
    }
    return names;
}

function next_mangled_name(def, options) {
    var scope = def.scope;
    var in_use = names_in_use(scope, options);
    var holes = scope.cname_holes;
    var names = new Dictionary();
    var scopes = [ scope ];
    def.forEach(function(sym) {
        var scope = sym.scope;
        do {
            if (member(scope, scopes)) break;
            names_in_use(scope, options).each(function(marker, name) {
                names.set(name, marker);
            });
            scopes.push(scope);
        } while (scope = scope.parent_scope);
    });
    var name;
    for (var i = 0; i < holes.length; i++) {
        name = base54(holes[i]);
        if (names.has(name)) continue;
        holes.splice(i, 1);
        in_use.set(name, true);
        return name;
    }
    while (true) {
        name = base54(++scope.cname);
        if (in_use.has(name) || RESERVED_WORDS[name] || options.reserved.has[name]) continue;
        if (!names.has(name)) break;
        holes.push(scope.cname);
    }
    in_use.set(name, true);
    return name;
}

AST_Symbol.DEFMETHOD("unmangleable", function(options) {
    var def = this.definition();
    return !def || def.unmangleable(options);
});

// labels are always mangleable
AST_Label.DEFMETHOD("unmangleable", return_false);

AST_Symbol.DEFMETHOD("definition", function() {
    return this.thedef;
});

function _default_mangler_options(options) {
    options = defaults(options, {
        eval        : false,
        ie          : false,
        keep_fargs  : false,
        keep_fnames : false,
        reserved    : [],
        toplevel    : false,
        v8          : false,
        webkit      : false,
    });
    if (!Array.isArray(options.reserved)) options.reserved = [];
    // Never mangle `arguments`
    push_uniq(options.reserved, "arguments");
    options.reserved.has = makePredicate(options.reserved);
    return options;
}

// We only need to mangle declaration nodes. Special logic wired into the code
// generator will display the mangled name if it is present (and for
// `AST_SymbolRef`s it will use the mangled name of the `AST_SymbolDeclaration`
// that it points to).
AST_Toplevel.DEFMETHOD("mangle_names", function(options) {
    options = _default_mangler_options(options);
    if (options.cache && options.cache.props) {
        var mangled_names = names_in_use(this, options);
        options.cache.props.each(function(mangled_name) {
            mangled_names.set(mangled_name, true);
        });
    }
    var cutoff = 36;
    var lname = -1;
    var redefined = [];
    var tw = new TreeWalker(function(node, descend) {
        var save_nesting;
        if (node instanceof AST_BlockScope) {
            // `lname` is incremented when we get to the `AST_Label`
            if (node instanceof AST_LabeledStatement) save_nesting = lname;
            if (options.webkit && node instanceof AST_IterationStatement && node.init instanceof AST_Let) {
                node.init.definitions.forEach(function(defn) {
                    defn.name.match_symbol(function(sym) {
                        if (!(sym instanceof AST_SymbolLet)) return;
                        var def = sym.definition();
                        var scope = sym.scope.parent_scope;
                        var redef = scope.def_variable(sym);
                        sym.thedef = def;
                        scope.to_mangle.push(redef);
                        def.redefined = function() {
                            return redef;
                        };
                    });
                }, true);
            }
            var to_mangle = node.to_mangle = [];
            node.variables.each(function(def) {
                if (!defer_redef(def)) to_mangle.push(def);
            });
            descend();
            if (options.cache && node instanceof AST_Toplevel) {
                node.globals.each(mangle);
            }
            if (node instanceof AST_Defun && tw.has_directive("use asm")) {
                var sym = new AST_SymbolRef(node.name);
                sym.scope = node;
                sym.reference(options);
            }
            if (to_mangle.length > cutoff) {
                var indices = to_mangle.map(function(def, index) {
                    return index;
                }).sort(function(i, j) {
                    return to_mangle[j].references.length - to_mangle[i].references.length || i - j;
                });
                to_mangle = indices.slice(0, cutoff).sort(function(i, j) {
                    return i - j;
                }).map(function(index) {
                    return to_mangle[index];
                }).concat(indices.slice(cutoff).sort(function(i, j) {
                    return i - j;
                }).map(function(index) {
                    return to_mangle[index];
                }));
            }
            to_mangle.forEach(mangle);
            if (node instanceof AST_LabeledStatement && !(options.v8 && in_label(tw))) lname = save_nesting;
            return true;
        }
        if (node instanceof AST_Label) {
            var name;
            do {
                name = base54(++lname);
            } while (RESERVED_WORDS[name]);
            node.mangled_name = name;
            return true;
        }
    });
    this.walk(tw);
    redefined.forEach(mangle);

    function mangle(def) {
        if (options.reserved.has[def.name]) return;
        def.mangle(options);
    }

    function defer_redef(def) {
        var sym = def.orig[0];
        var redef = def.redefined();
        if (!redef) {
            if (!(sym instanceof AST_SymbolConst)) return false;
            var scope = def.scope.resolve();
            if (def.scope === scope) return false;
            if (def.scope.parent_scope.find_variable(sym.name)) return false;
            redef = scope.def_variable(sym);
            scope.to_mangle.push(redef);
        }
        redefined.push(def);
        def.references.forEach(reference);
        if (sym instanceof AST_SymbolCatch || sym instanceof AST_SymbolConst) {
            reference(sym);
            def.redefined = function() {
                return redef;
            };
        }
        return true;

        function reference(sym) {
            sym.thedef = redef;
            sym.reference(options);
            sym.thedef = def;
        }
    }

    function in_label(tw) {
        var level = 0, parent;
        while (parent = tw.parent(level++)) {
            if (parent instanceof AST_Block) return parent instanceof AST_Toplevel && !options.toplevel;
            if (parent instanceof AST_LabeledStatement) return true;
        }
    }
});

AST_Toplevel.DEFMETHOD("find_colliding_names", function(options) {
    var cache = options.cache && options.cache.props;
    var avoid = Object.create(RESERVED_WORDS);
    options.reserved.forEach(to_avoid);
    this.globals.each(add_def);
    this.walk(new TreeWalker(function(node) {
        if (node instanceof AST_BlockScope) node.variables.each(add_def);
    }));
    return avoid;

    function to_avoid(name) {
        avoid[name] = true;
    }

    function add_def(def) {
        var name = def.name;
        if (def.global && cache && cache.has(name)) name = cache.get(name);
        else if (!def.unmangleable(options)) return;
        to_avoid(name);
    }
});

AST_Toplevel.DEFMETHOD("expand_names", function(options) {
    base54.reset();
    base54.sort();
    options = _default_mangler_options(options);
    var avoid = this.find_colliding_names(options);
    var cname = 0;
    this.globals.each(rename);
    this.walk(new TreeWalker(function(node) {
        if (node instanceof AST_BlockScope) node.variables.each(rename);
    }));

    function next_name() {
        var name;
        do {
            name = base54(cname++);
        } while (avoid[name]);
        return name;
    }

    function rename(def) {
        if (def.global && options.cache) return;
        if (def.unmangleable(options)) return;
        if (options.reserved.has[def.name]) return;
        var redef = def.redefined();
        var name = redef ? redef.rename || redef.name : next_name();
        def.rename = name;
        def.forEach(function(sym) {
            if (sym.definition() === def) sym.name = name;
        });
    }
});

AST_Node.DEFMETHOD("tail_node", return_this);
AST_Sequence.DEFMETHOD("tail_node", function() {
    return this.expressions[this.expressions.length - 1];
});

AST_Toplevel.DEFMETHOD("compute_char_frequency", function(options) {
    options = _default_mangler_options(options);
    base54.reset();
    var fn = AST_Symbol.prototype.add_source_map;
    try {
        AST_Symbol.prototype.add_source_map = function() {
            if (!this.unmangleable(options)) base54.consider(this.name, -1);
        };
        if (options.properties) {
            AST_Dot.prototype.add_source_map = function() {
                base54.consider(this.property, -1);
            };
            AST_Sub.prototype.add_source_map = function() {
                skip_string(this.property);
            };
        }
        base54.consider(this.print_to_string(), 1);
    } finally {
        AST_Symbol.prototype.add_source_map = fn;
        delete AST_Dot.prototype.add_source_map;
        delete AST_Sub.prototype.add_source_map;
    }
    base54.sort();

    function skip_string(node) {
        if (node instanceof AST_String) {
            base54.consider(node.value, -1);
        } else if (node instanceof AST_Conditional) {
            skip_string(node.consequent);
            skip_string(node.alternative);
        } else if (node instanceof AST_Sequence) {
            skip_string(node.tail_node());
        }
    }
});

var base54 = (function() {
    var freq = Object.create(null);
    function init(chars) {
        var array = [];
        for (var i = 0; i < chars.length; i++) {
            var ch = chars[i];
            array.push(ch);
            freq[ch] = -1e-2 * i;
        }
        return array;
    }
    var digits = init("0123456789");
    var leading = init("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$_");
    var chars, frequency;
    function reset() {
        chars = null;
        frequency = Object.create(freq);
    }
    base54.consider = function(str, delta) {
        for (var i = str.length; --i >= 0;) {
            frequency[str[i]] += delta;
        }
    };
    function compare(a, b) {
        return frequency[b] - frequency[a];
    }
    base54.sort = function() {
        chars = leading.sort(compare).concat(digits).sort(compare);
    };
    base54.reset = reset;
    reset();
    function base54(num) {
        var ret = leading[num % 54];
        for (num = Math.floor(num / 54); --num >= 0; num >>= 6) {
            ret += chars[num & 0x3F];
        }
        return ret;
    }
    return base54;
})();


/***********************************************************************

  A JavaScript tokenizer / parser / beautifier / compressor.
  https://github.com/mishoo/UglifyJS

  -------------------------------- (C) ---------------------------------

                           Author: Mihai Bazon
                         <mihai.bazon@gmail.com>
                       http://mihai.bazon.net/blog

  Distributed under the BSD license:

    Copyright 2012 (c) Mihai Bazon <mihai.bazon@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:

        * Redistributions of source code must retain the above
          copyright notice, this list of conditions and the following
          disclaimer.

        * Redistributions in binary form must reproduce the above
          copyright notice, this list of conditions and the following
          disclaimer in the documentation and/or other materials
          provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
    EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
    PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
    OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
    PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
    PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
    TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
    THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
    SUCH DAMAGE.

 ***********************************************************************/

"use strict";

function Compressor(options, false_by_default) {
    if (!(this instanceof Compressor))
        return new Compressor(options, false_by_default);
    TreeTransformer.call(this, this.before, this.after);
    this.options = defaults(options, {
        annotations     : !false_by_default,
        arguments       : !false_by_default,
        arrows          : !false_by_default,
        assignments     : !false_by_default,
        awaits          : !false_by_default,
        booleans        : !false_by_default,
        collapse_vars   : !false_by_default,
        comparisons     : !false_by_default,
        conditionals    : !false_by_default,
        dead_code       : !false_by_default,
        default_values  : !false_by_default,
        directives      : !false_by_default,
        drop_console    : false,
        drop_debugger   : !false_by_default,
        evaluate        : !false_by_default,
        expression      : false,
        functions       : !false_by_default,
        global_defs     : false,
        hoist_exports   : !false_by_default,
        hoist_funs      : false,
        hoist_props     : !false_by_default,
        hoist_vars      : false,
        ie              : false,
        if_return       : !false_by_default,
        imports         : !false_by_default,
        inline          : !false_by_default,
        join_vars       : !false_by_default,
        keep_fargs      : false_by_default,
        keep_fnames     : false,
        keep_infinity   : false,
        loops           : !false_by_default,
        merge_vars      : !false_by_default,
        module          : false,
        negate_iife     : !false_by_default,
        objects         : !false_by_default,
        optional_chains : !false_by_default,
        passes          : 1,
        properties      : !false_by_default,
        pure_funcs      : null,
        pure_getters    : !false_by_default && "strict",
        reduce_funcs    : !false_by_default,
        reduce_vars     : !false_by_default,
        rests           : !false_by_default,
        sequences       : !false_by_default,
        side_effects    : !false_by_default,
        spreads         : !false_by_default,
        strings         : !false_by_default,
        switches        : !false_by_default,
        templates       : !false_by_default,
        top_retain      : null,
        toplevel        : !!(options && (options["module"] || options["top_retain"])),
        typeofs         : !false_by_default,
        unsafe          : false,
        unsafe_comps    : false,
        unsafe_Function : false,
        unsafe_math     : false,
        unsafe_proto    : false,
        unsafe_regexp   : false,
        unsafe_undefined: false,
        unused          : !false_by_default,
        varify          : !false_by_default,
        webkit          : false,
        yields          : !false_by_default,
    }, true);
    var evaluate = this.options["evaluate"];
    this.eval_threshold = /eager/.test(evaluate) ? 1 / 0 : +evaluate;
    var global_defs = this.options["global_defs"];
    if (typeof global_defs == "object") for (var key in global_defs) {
        if (/^@/.test(key) && HOP(global_defs, key)) {
            global_defs[key.slice(1)] = parse(global_defs[key], { expression: true });
        }
    }
    if (this.options["inline"] === true) this.options["inline"] = 4;
    this.drop_fargs = this.options["keep_fargs"] ? return_false : function(lambda, parent) {
        if (lambda.length_read) return false;
        var name = lambda.name;
        if (!name) return parent && parent.TYPE == "Call" && parent.expression === lambda;
        if (name.fixed_value() !== lambda) return false;
        var def = name.definition();
        if (def.direct_access) return false;
        var escaped = def.escaped;
        return escaped && escaped.depth != 1;
    };
    if (this.options["module"]) this.directives["use strict"] = true;
    var pure_funcs = this.options["pure_funcs"];
    if (typeof pure_funcs == "function") {
        this.pure_funcs = pure_funcs;
    } else if (typeof pure_funcs == "string") {
        this.pure_funcs = function(node) {
            var expr;
            if (node instanceof AST_Call) {
                expr = node.expression;
            } else if (node instanceof AST_Template) {
                expr = node.tag;
            }
            return !(expr && pure_funcs === expr.print_to_string());
        };
    } else if (Array.isArray(pure_funcs)) {
        this.pure_funcs = function(node) {
            var expr;
            if (node instanceof AST_Call) {
                expr = node.expression;
            } else if (node instanceof AST_Template) {
                expr = node.tag;
            }
            return !(expr && member(expr.print_to_string(), pure_funcs));
        };
    } else {
        this.pure_funcs = return_true;
    }
    var sequences = this.options["sequences"];
    this.sequences_limit = sequences == 1 ? 800 : sequences | 0;
    var top_retain = this.options["top_retain"];
    if (top_retain instanceof RegExp) {
        this.top_retain = function(def) {
            return top_retain.test(def.name);
        };
    } else if (typeof top_retain == "function") {
        this.top_retain = top_retain;
    } else if (top_retain) {
        if (typeof top_retain == "string") {
            top_retain = top_retain.split(/,/);
        }
        this.top_retain = function(def) {
            return member(def.name, top_retain);
        };
    }
    var toplevel = this.options["toplevel"];
    this.toplevel = typeof toplevel == "string" ? {
        funcs: /funcs/.test(toplevel),
        vars: /vars/.test(toplevel)
    } : {
        funcs: toplevel,
        vars: toplevel
    };
}

Compressor.prototype = new TreeTransformer(function(node, descend, in_list) {
    if (node._squeezed) return node;
    var is_scope = node instanceof AST_Scope;
    if (is_scope) {
        if (this.option("arrows") && is_arrow(node) && node.value) {
            node.body = [ node.first_statement() ];
            node.value = null;
        }
        node.hoist_properties(this);
        node.hoist_declarations(this);
        node.process_returns(this);
    }
    // Before https://github.com/mishoo/UglifyJS/pull/1602 AST_Node.optimize()
    // would call AST_Node.transform() if a different instance of AST_Node is
    // produced after OPT().
    // This corrupts TreeWalker.stack, which cause AST look-ups to malfunction.
    // Migrate and defer all children's AST_Node.transform() to below, which
    // will now happen after this parent AST_Node has been properly substituted
    // thus gives a consistent AST snapshot.
    descend(node, this);
    // Existing code relies on how AST_Node.optimize() worked, and omitting the
    // following replacement call would result in degraded efficiency of both
    // output and performance.
    descend(node, this);
    var opt = node.optimize(this);
    if (is_scope && opt === node && !this.has_directive("use asm") && !opt.pinned()) {
        opt.drop_unused(this);
        if (opt.merge_variables(this)) opt.drop_unused(this);
        descend(opt, this);
    }
    if (opt === node) opt._squeezed = true;
    return opt;
});
Compressor.prototype.option = function(key) {
    return this.options[key];
};
Compressor.prototype.exposed = function(def) {
    if (def.exported) return true;
    if (def.undeclared) return true;
    if (!(def.global || def.scope.resolve() instanceof AST_Toplevel)) return false;
    var toplevel = this.toplevel;
    return !all(def.orig, function(sym) {
        return toplevel[sym instanceof AST_SymbolDefun ? "funcs" : "vars"];
    });
};
Compressor.prototype.compress = function(node) {
    node = node.resolve_defines(this);
    node.hoist_exports(this);
    if (this.option("expression")) node.process_expression(true);
    var merge_vars = this.options.merge_vars;
    var passes = +this.options.passes || 1;
    var min_count = 1 / 0;
    var stopping = false;
    var mangle = { ie: this.option("ie") };
    for (var pass = 0; pass < passes; pass++) {
        node.figure_out_scope(mangle);
        if (pass > 0 || this.option("reduce_vars"))
            node.reset_opt_flags(this);
        this.options.merge_vars = merge_vars && (stopping || pass == passes - 1);
        node = node.transform(this);
        if (passes > 1) {
            var count = 0;
            node.walk(new TreeWalker(function() {
                count++;
            }));
            AST_Node.info("pass {pass}: last_count: {min_count}, count: {count}", {
                pass: pass,
                min_count: min_count,
                count: count,
            });
            if (count < min_count) {
                min_count = count;
                stopping = false;
            } else if (stopping) {
                break;
            } else {
                stopping = true;
            }
        }
    }
    if (this.option("expression")) node.process_expression(false);
    return node;
};

(function(OPT) {
    OPT(AST_Node, function(self, compressor) {
        return self;
    });

    AST_Toplevel.DEFMETHOD("hoist_exports", function(compressor) {
        if (!compressor.option("hoist_exports")) return;
        var body = this.body, props = [];
        for (var i = 0; i < body.length; i++) {
            var stat = body[i];
            if (stat instanceof AST_ExportDeclaration) {
                body[i] = stat = stat.body;
                if (stat instanceof AST_Definitions) {
                    stat.definitions.forEach(function(defn) {
                        defn.name.match_symbol(export_symbol, true);
                    });
                } else {
                    export_symbol(stat.name);
                }
            } else if (stat instanceof AST_ExportReferences) {
                body.splice(i--, 1);
                [].push.apply(props, stat.properties);
            }
        }
        if (props.length) body.push(make_node(AST_ExportReferences, this, { properties: props }));

        function export_symbol(sym) {
            if (!(sym instanceof AST_SymbolDeclaration)) return;
            var node = make_node(AST_SymbolExport, sym);
            node.alias = make_node(AST_String, node, { value: node.name });
            props.push(node);
        }
    });

    AST_Scope.DEFMETHOD("process_expression", function(insert, transform) {
        var self = this;
        var tt = new TreeTransformer(function(node) {
            if (insert) {
                if (node instanceof AST_Directive) node = make_node(AST_SimpleStatement, node, {
                    body: make_node(AST_String, node),
                });
                if (node instanceof AST_SimpleStatement) {
                    return transform ? transform(node) : make_node(AST_Return, node, { value: node.body });
                }
            } else if (node instanceof AST_Return) {
                if (transform) return transform(node);
                var value = node.value;
                if (value instanceof AST_String) return make_node(AST_Directive, value);
                return make_node(AST_SimpleStatement, node, {
                    body: value || make_node(AST_UnaryPrefix, node, {
                        operator: "void",
                        expression: make_node(AST_Number, node, { value: 0 }),
                    }),
                });
            }
            if (node instanceof AST_Block) {
                if (node instanceof AST_Lambda) {
                    if (node !== self) return node;
                } else if (insert === "awaits" && node instanceof AST_Try) {
                    if (node.bfinally) return node;
                }
                for (var index = node.body.length; --index >= 0;) {
                    var stat = node.body[index];
                    if (!is_declaration(stat, true)) {
                        node.body[index] = stat.transform(tt);
                        break;
                    }
                }
            } else if (node instanceof AST_If) {
                node.body = node.body.transform(tt);
                if (node.alternative) node.alternative = node.alternative.transform(tt);
            } else if (node instanceof AST_With) {
                node.body = node.body.transform(tt);
            }
            return node;
        });
        self.transform(tt);
    });
    AST_Toplevel.DEFMETHOD("unwrap_expression", function() {
        var self = this;
        switch (self.body.length) {
          case 0:
            return make_node(AST_UnaryPrefix, self, {
                operator: "void",
                expression: make_node(AST_Number, self, { value: 0 }),
            });
          case 1:
            var stat = self.body[0];
            if (stat instanceof AST_Directive) return make_node(AST_String, stat);
            if (stat instanceof AST_SimpleStatement) return stat.body;
          default:
            return make_node(AST_Call, self, {
                expression: make_node(AST_Function, self, {
                    argnames: [],
                    body: self.body,
                }).init_vars(self),
                args: [],
            });
        }
    });
    AST_Node.DEFMETHOD("wrap_expression", function() {
        var self = this;
        if (!is_statement(self)) self = make_node(AST_SimpleStatement, self, { body: self });
        if (!(self instanceof AST_Toplevel)) self = make_node(AST_Toplevel, self, { body: [ self ] });
        return self;
    });

    function read_property(obj, node) {
        var key = node.get_property();
        if (key instanceof AST_Node) return;
        var value;
        if (obj instanceof AST_Array) {
            var elements = obj.elements;
            if (key == "length") return make_node_from_constant(elements.length, obj);
            if (typeof key == "number" && key in elements) value = elements[key];
        } else if (obj instanceof AST_Lambda) {
            if (key == "length") {
                obj.length_read = true;
                return make_node_from_constant(obj.argnames.length, obj);
            }
        } else if (obj instanceof AST_Object) {
            key = "" + key;
            var props = obj.properties;
            for (var i = props.length; --i >= 0;) {
                var prop = props[i];
                if (!can_hoist_property(prop)) return;
                if (!value && props[i].key === key) value = props[i].value;
            }
        }
        return value instanceof AST_SymbolRef && value.fixed_value() || value;
    }

    function is_read_only_fn(value, name) {
        if (value instanceof AST_Boolean) return native_fns.Boolean[name];
        if (value instanceof AST_Number) return native_fns.Number[name];
        if (value instanceof AST_String) return native_fns.String[name];
        if (name == "valueOf") return false;
        if (value instanceof AST_Array) return native_fns.Array[name];
        if (value instanceof AST_Lambda) return native_fns.Function[name];
        if (value instanceof AST_Object) return native_fns.Object[name];
        if (value instanceof AST_RegExp) return native_fns.RegExp[name] && !value.value.global;
    }

    function is_modified(compressor, tw, node, value, level, immutable, recursive) {
        var parent = tw.parent(level);
        if (compressor.option("unsafe") && parent instanceof AST_Dot && is_read_only_fn(value, parent.property)) {
            return;
        }
        var lhs = is_lhs(node, parent);
        if (lhs) return lhs;
        if (level == 0 && value && value.is_constant()) return;
        if (parent instanceof AST_Array) return is_modified(compressor, tw, parent, parent, level + 1);
        if (parent instanceof AST_Assign) switch (parent.operator) {
          case "=":
            return is_modified(compressor, tw, parent, value, level + 1, immutable, recursive);
          case "&&=":
          case "||=":
          case "??=":
            return is_modified(compressor, tw, parent, parent, level + 1);
          default:
            return;
        }
        if (parent instanceof AST_Binary) {
            if (!lazy_op[parent.operator]) return;
            return is_modified(compressor, tw, parent, parent, level + 1);
        }
        if (parent instanceof AST_Call) {
            return !immutable
                && parent.expression === node
                && !parent.is_expr_pure(compressor)
                && (!(value instanceof AST_LambdaExpression) || !(parent instanceof AST_New) && value.contains_this());
        }
        if (parent instanceof AST_Conditional) {
            if (parent.condition === node) return;
            return is_modified(compressor, tw, parent, parent, level + 1);
        }
        if (parent instanceof AST_ForEnumeration) return parent.init === node;
        if (parent instanceof AST_ObjectKeyVal) {
            if (parent.value !== node) return;
            var obj = tw.parent(level + 1);
            return is_modified(compressor, tw, obj, obj, level + 2);
        }
        if (parent instanceof AST_PropAccess) {
            if (parent.expression !== node) return;
            var prop = read_property(value, parent);
            return (!immutable || recursive) && is_modified(compressor, tw, parent, prop, level + 1);
        }
        if (parent instanceof AST_Sequence) {
            if (parent.tail_node() !== node) return;
            return is_modified(compressor, tw, parent, value, level + 1, immutable, recursive);
        }
    }

    function is_lambda(node) {
        return node instanceof AST_Class || node instanceof AST_Lambda;
    }

    function safe_for_extends(node) {
        return node instanceof AST_Class || node instanceof AST_Defun || node instanceof AST_Function;
    }

    function is_arguments(def) {
        return def.name == "arguments" && def.scope.uses_arguments;
    }

    function cross_scope(def, sym) {
        do {
            if (def === sym) return false;
            if (sym instanceof AST_Scope) return true;
        } while (sym = sym.parent_scope);
    }

    function can_drop_symbol(ref, compressor, keep_lambda) {
        var def = ref.redef || ref.definition();
        if (ref.in_arg && is_funarg(def)) return false;
        return all(def.orig, function(sym) {
            if (sym instanceof AST_SymbolConst || sym instanceof AST_SymbolLet) {
                if (sym instanceof AST_SymbolImport) return true;
                return compressor && can_varify(compressor, sym);
            }
            return !(keep_lambda && sym instanceof AST_SymbolLambda);
        });
    }

    function has_escaped(d, scope, node, parent) {
        if (parent instanceof AST_Assign) return parent.operator == "=" && parent.right === node;
        if (parent instanceof AST_Call) return parent.expression !== node || parent instanceof AST_New;
        if (parent instanceof AST_ClassField) return parent.value === node && !parent.static;
        if (parent instanceof AST_Exit) return parent.value === node && scope.resolve() !== d.scope.resolve();
        if (parent instanceof AST_VarDef) return parent.value === node;
    }

    function make_ref(ref, fixed) {
        var node = make_node(AST_SymbolRef, ref);
        node.fixed = fixed || make_node(AST_Undefined, ref);
        return node;
    }

    function replace_ref(resolve, fixed) {
        return function(node) {
            var ref = resolve(node);
            var node = make_ref(ref, fixed);
            var def = ref.definition();
            def.references.push(node);
            def.replaced++;
            return node;
        };
    }

    var RE_POSITIVE_INTEGER = /^(0|[1-9][0-9]*)$/;
    (function(def) {
        def(AST_Node, noop);

        function reset_def(tw, compressor, def) {
            def.assignments = 0;
            def.bool_return = 0;
            def.drop_return = 0;
            def.cross_loop = false;
            def.direct_access = false;
            def.escaped = [];
            def.fixed = !def.const_redefs
                && !def.scope.pinned()
                && !compressor.exposed(def)
                && !(def.init instanceof AST_LambdaExpression && def.init !== def.scope)
                && def.init;
            def.reassigned = 0;
            def.recursive_refs = 0;
            def.references = [];
            def.single_use = undefined;
        }

        function reset_block_variables(tw, compressor, scope) {
            scope.variables.each(function(def) {
                reset_def(tw, compressor, def);
            });
        }

        function reset_variables(tw, compressor, scope) {
            scope.fn_defs = [];
            scope.variables.each(function(def) {
                reset_def(tw, compressor, def);
                var init = def.init;
                if (init instanceof AST_LambdaDefinition) {
                    scope.fn_defs.push(init);
                    init.safe_ids = null;
                }
                if (def.fixed === null) {
                    def.safe_ids = tw.safe_ids;
                    mark(tw, def);
                } else if (def.fixed) {
                    tw.loop_ids[def.id] = tw.in_loop;
                    mark(tw, def);
                }
            });
            scope.may_call_this = function() {
                scope.may_call_this = scope.contains_this() ? return_true : return_false;
            };
            if (scope.uses_arguments) scope.each_argname(function(node) {
                node.definition().last_ref = false;
            });
            if (compressor.option("ie")) scope.variables.each(function(def) {
                var d = def.orig[0].definition();
                if (d !== def) d.fixed = false;
            });
        }

        function safe_to_visit(tw, fn) {
            var marker = fn.safe_ids;
            return marker === undefined || marker === tw.safe_ids;
        }

        function walk_fn_def(tw, fn) {
            var was_scanning = tw.fn_scanning;
            tw.fn_scanning = fn;
            fn.walk(tw);
            tw.fn_scanning = was_scanning;
        }

        function revisit_fn_def(tw, fn) {
            fn.enclosed.forEach(function(d) {
                if (fn.variables.get(d.name) === d) return;
                if (safe_to_read(tw, d)) return;
                d.single_use = false;
                var fixed = d.fixed;
                if (typeof fixed == "function") fixed = fixed();
                if (fixed instanceof AST_Lambda && fixed.safe_ids !== undefined) return;
                d.fixed = false;
            });
        }

        function mark_fn_def(tw, def, fn) {
            var marker = fn.safe_ids;
            if (marker === undefined) return;
            if (marker === false) return;
            if (fn.parent_scope.resolve().may_call_this === return_true) {
                if (member(fn, tw.fn_visited)) revisit_fn_def(tw, fn);
            } else if (marker) {
                var visited = member(fn, tw.fn_visited);
                if (marker === tw.safe_ids) {
                    if (!visited) walk_fn_def(tw, fn);
                } else if (visited) {
                    revisit_fn_def(tw, fn);
                } else {
                    fn.safe_ids = false;
                }
            } else if (tw.fn_scanning && tw.fn_scanning !== def.scope.resolve()) {
                fn.safe_ids = false;
            } else {
                fn.safe_ids = tw.safe_ids;
                walk_fn_def(tw, fn);
            }
        }

        function pop_scope(tw, scope) {
            var fn_defs = scope.fn_defs;
            var tangled = scope.may_call_this === return_true ? fn_defs : fn_defs.filter(function(fn) {
                if (fn.safe_ids === false) return true;
                fn.safe_ids = tw.safe_ids;
                walk_fn_def(tw, fn);
                return false;
            });
            pop(tw);
            tangled.forEach(function(fn) {
                fn.safe_ids = tw.safe_ids;
                walk_fn_def(tw, fn);
            });
            fn_defs.forEach(function(fn) {
                fn.safe_ids = undefined;
            });
            scope.fn_defs = undefined;
            scope.may_call_this = undefined;
        }

        function push(tw, sequential) {
            var safe_ids = Object.create(tw.safe_ids);
            if (!sequential) safe_ids.seq = {};
            tw.safe_ids = safe_ids;
        }

        function pop(tw) {
            tw.safe_ids = Object.getPrototypeOf(tw.safe_ids);
        }

        function mark(tw, def) {
            tw.safe_ids[def.id] = {};
        }

        function push_ref(def, ref) {
            def.references.push(ref);
            if (def.last_ref !== false) def.last_ref = ref;
        }

        function safe_to_read(tw, def) {
            if (def.single_use == "m") return false;
            var safe = tw.safe_ids[def.id];
            if (safe) {
                var in_order = HOP(tw.safe_ids, def.id);
                if (!in_order) {
                    var seq = tw.safe_ids.seq;
                    if (!safe.read) {
                        safe.read = seq;
                    } else if (safe.read !== seq) {
                        safe.read = true;
                    }
                }
                if (def.fixed == null) {
                    if (is_arguments(def)) return false;
                    if (def.global && def.name == "arguments") return false;
                    tw.loop_ids[def.id] = null;
                    def.fixed = make_node(AST_Undefined, def.orig[0]);
                    if (in_order) def.safe_ids = undefined;
                    return true;
                }
                return !safe.assign || safe.assign === tw.safe_ids;
            }
            return def.fixed instanceof AST_LambdaDefinition;
        }

        function safe_to_assign(tw, def, declare) {
            if (!declare) {
                if (is_funarg(def) && def.scope.uses_arguments && !tw.has_directive("use strict")) return false;
                if (!all(def.orig, function(sym) {
                    return !(sym instanceof AST_SymbolConst);
                })) return false;
            }
            if (def.fixed === undefined) return declare || all(def.orig, function(sym) {
                return !(sym instanceof AST_SymbolLet);
            });
            if (def.fixed === false || def.fixed === 0) return false;
            var safe = tw.safe_ids[def.id];
            if (def.safe_ids) {
                def.safe_ids[def.id] = false;
                def.safe_ids = undefined;
                return def.fixed === null || HOP(tw.safe_ids, def.id) && !safe.read;
            }
            if (!HOP(tw.safe_ids, def.id)) {
                if (!safe) return false;
                if (safe.read || tw.in_loop) {
                    var scope = tw.find_parent(AST_BlockScope);
                    if (scope instanceof AST_Class) return false;
                    if (def.scope.resolve() !== scope.resolve()) return false;
                }
                safe.assign = safe.assign && safe.assign !== tw.safe_ids ? true : tw.safe_ids;
            }
            if (def.fixed != null && safe.read) {
                if (safe.read !== tw.safe_ids.seq) return false;
                if (tw.loop_ids[def.id] !== tw.in_loop) return false;
            }
            return safe_to_read(tw, def) && all(def.orig, function(sym) {
                return !(sym instanceof AST_SymbolLambda);
            });
        }

        function ref_once(compressor, def) {
            return compressor.option("unused")
                && !def.scope.pinned()
                && def.single_use !== false
                && def.references.length - def.recursive_refs == 1
                && !(is_funarg(def) && def.scope.uses_arguments);
        }

        function is_immutable(value) {
            if (!value) return false;
            if (value instanceof AST_Assign) {
                var op = value.operator;
                return op == "=" ? is_immutable(value.right) : !lazy_op[op.slice(0, -1)];
            }
            if (value instanceof AST_Sequence) return is_immutable(value.tail_node());
            return value.is_constant() || is_lambda(value) || value instanceof AST_ObjectIdentity;
        }

        function value_in_use(node, parent) {
            if (parent instanceof AST_Array) return true;
            if (parent instanceof AST_Binary) return lazy_op[parent.operator];
            if (parent instanceof AST_Conditional) return parent.condition !== node;
            if (parent instanceof AST_Sequence) return parent.tail_node() === node;
            if (parent instanceof AST_Spread) return true;
        }

        function mark_escaped(tw, d, scope, node, value, level, depth) {
            var parent = tw.parent(level);
            if (value && value.is_constant()) return;
            if (has_escaped(d, scope, node, parent)) {
                d.escaped.push(parent);
                if (depth > 1 && !(value && value.is_constant_expression(scope))) depth = 1;
                if (!d.escaped.depth || d.escaped.depth > depth) d.escaped.depth = depth;
                if (d.scope.resolve() !== scope.resolve()) d.escaped.cross_scope = true;
                if (d.fixed) d.fixed.escaped = d.escaped;
                return;
            } else if (value_in_use(node, parent)) {
                mark_escaped(tw, d, scope, parent, parent, level + 1, depth);
            } else if (parent instanceof AST_ObjectKeyVal && parent.value === node) {
                var obj = tw.parent(level + 1);
                mark_escaped(tw, d, scope, obj, obj, level + 2, depth);
            } else if (parent instanceof AST_PropAccess && parent.expression === node) {
                value = read_property(value, parent);
                mark_escaped(tw, d, scope, parent, value, level + 1, depth + 1);
                if (value) return;
            }
            if (level > 0) return;
            if (parent instanceof AST_Call && parent.expression === node) return;
            if (parent instanceof AST_Sequence && parent.tail_node() !== node) return;
            if (parent instanceof AST_SimpleStatement) return;
            if (parent instanceof AST_Unary && !unary_side_effects[parent.operator]) return;
            d.direct_access = true;
            if (d.fixed) d.fixed.direct_access = true;
        }

        function mark_assignment_to_arguments(node) {
            if (!(node instanceof AST_Sub)) return;
            var expr = node.expression;
            if (!(expr instanceof AST_SymbolRef)) return;
            var def = expr.definition();
            if (!is_arguments(def)) return;
            var key = node.property;
            if (key.is_constant()) key = key.value;
            if (!(key instanceof AST_Node) && !RE_POSITIVE_INTEGER.test(key)) return;
            def.reassigned++;
            (key instanceof AST_Node ? def.scope.argnames : [ def.scope.argnames[key] ]).forEach(function(argname) {
                if (argname instanceof AST_SymbolFunarg) argname.definition().fixed = false;
            });
        }

        function make_fixed(save, fn) {
            var prev_save, prev_value;
            return function() {
                var current = save();
                if (prev_save !== current) {
                    prev_save = current;
                    prev_value = fn(current);
                }
                return prev_value;
            };
        }

        function make_fixed_default(compressor, node, save) {
            var prev_save, prev_seq;
            return function() {
                if (prev_seq === node) return node;
                var current = save();
                var ev = fuzzy_eval(compressor, current, true);
                if (ev instanceof AST_Node) {
                    prev_seq = node;
                } else if (prev_save !== current) {
                    prev_save = current;
                    prev_seq = ev === undefined ? make_sequence(node, [ current, node.value ]) : current;
                }
                return prev_seq;
            };
        }

        function scan_declaration(tw, compressor, lhs, fixed, visit) {
            var scanner = new TreeWalker(function(node) {
                if (node instanceof AST_DefaultValue) {
                    reset_flags(node);
                    push(tw, true);
                    node.value.walk(tw);
                    pop(tw);
                    var save = fixed;
                    if (save) fixed = make_fixed_default(compressor, node, save);
                    node.name.walk(scanner);
                    fixed = save;
                    return true;
                }
                if (node instanceof AST_DestructuredArray) {
                    reset_flags(node);
                    var save = fixed;
                    node.elements.forEach(function(node, index) {
                        if (node instanceof AST_Hole) return reset_flags(node);
                        if (save) fixed = make_fixed(save, function(value) {
                            return make_node(AST_Sub, node, {
                                expression: value,
                                property: make_node(AST_Number, node, { value: index }),
                            });
                        });
                        node.walk(scanner);
                    });
                    if (node.rest) {
                        var fixed_node;
                        if (save) fixed = compressor.option("rests") && make_fixed(save, function(value) {
                            if (!(value instanceof AST_Array)) return node;
                            for (var i = 0, len = node.elements.length; i < len; i++) {
                                if (value.elements[i] instanceof AST_Spread) return node;
                            }
                            if (!fixed_node) fixed_node = make_node(AST_Array, node, {});
                            fixed_node.elements = value.elements.slice(len);
                            return fixed_node;
                        });
                        node.rest.walk(scanner);
                    }
                    fixed = save;
                    return true;
                }
                if (node instanceof AST_DestructuredObject) {
                    reset_flags(node);
                    var save = fixed;
                    node.properties.forEach(function(node) {
                        reset_flags(node);
                        if (node.key instanceof AST_Node) {
                            push(tw);
                            node.key.walk(tw);
                            pop(tw);
                        }
                        if (save) fixed = make_fixed(save, function(value) {
                            var key = node.key;
                            var type = AST_Sub;
                            if (typeof key == "string") {
                                if (is_identifier_string(key)) {
                                    type = AST_Dot;
                                } else {
                                    key = make_node_from_constant(key, node);
                                }
                            }
                            return make_node(type, node, {
                                expression: value,
                                property: key,
                            });
                        });
                        node.value.walk(scanner);
                    });
                    if (node.rest) {
                        fixed = false;
                        node.rest.walk(scanner);
                    }
                    fixed = save;
                    return true;
                }
                visit(node, fixed, function() {
                    var save_len = tw.stack.length;
                    for (var i = 0, len = scanner.stack.length - 1; i < len; i++) {
                        tw.stack.push(scanner.stack[i]);
                    }
                    node.walk(tw);
                    tw.stack.length = save_len;
                });
                return true;
            });
            lhs.walk(scanner);
        }

        function reduce_iife(tw, descend, compressor) {
            var fn = this;
            fn.inlined = false;
            var iife = tw.parent();
            var sequential = !is_async(fn) && !is_generator(fn);
            var hit = !sequential;
            var aborts = false;
            fn.walk(new TreeWalker(function(node) {
                if (hit) return aborts = true;
                if (node instanceof AST_Return) return hit = true;
                if (node instanceof AST_Scope && node !== fn) return true;
            }));
            if (aborts) push(tw, sequential);
            reset_variables(tw, compressor, fn);
            // Virtually turn IIFE parameters into variable definitions:
            //   (function(a,b) {...})(c,d) ---> (function() {var a=c,b=d; ...})()
            // So existing transformation rules can work on them.
            var safe = !fn.uses_arguments || tw.has_directive("use strict");
            fn.argnames.forEach(function(argname, i) {
                var value = iife.args[i];
                scan_declaration(tw, compressor, argname, function() {
                    var j = fn.argnames.indexOf(argname);
                    var arg = j < 0 ? value : iife.args[j];
                    if (arg instanceof AST_Sequence && arg.expressions.length < 2) arg = arg.expressions[0];
                    return arg || make_node(AST_Undefined, iife);
                }, visit);
            });
            var rest = fn.rest, fixed_node;
            if (rest) scan_declaration(tw, compressor, rest, compressor.option("rests") && function() {
                if (fn.rest !== rest) return rest;
                if (!fixed_node) fixed_node = make_node(AST_Array, fn, {});
                fixed_node.elements = iife.args.slice(fn.argnames.length);
                return fixed_node;
            }, visit);
            walk_lambda(fn, tw);
            var safe_ids = tw.safe_ids;
            pop_scope(tw, fn);
            if (!aborts) tw.safe_ids = safe_ids;
            return true;

            function visit(node, fixed) {
                var d = node.definition();
                if (fixed && safe && d.fixed === undefined) {
                    mark(tw, d);
                    tw.loop_ids[d.id] = tw.in_loop;
                    d.fixed = fixed;
                    d.fixed.assigns = [ node ];
                } else {
                    d.fixed = false;
                }
            }
        }

        def(AST_Assign, function(tw, descend, compressor) {
            var node = this;
            var left = node.left;
            var right = node.right;
            var ld = left instanceof AST_SymbolRef && left.definition();
            var scan = ld || left instanceof AST_Destructured;
            switch (node.operator) {
              case "=":
                if (left.equals(right) && !left.has_side_effects(compressor)) {
                    right.walk(tw);
                    walk_prop(left);
                    node.redundant = true;
                    return true;
                }
                if (ld && right instanceof AST_LambdaExpression) {
                    walk_assign();
                    right.parent_scope.resolve().fn_defs.push(right);
                    right.safe_ids = null;
                    if (!ld.fixed || !node.write_only) mark_fn_def(tw, ld, right);
                    return true;
                }
                if (scan) {
                    right.walk(tw);
                    walk_assign();
                    return true;
                }
                mark_assignment_to_arguments(left);
                return;
              case "&&=":
              case "||=":
              case "??=":
                var lazy = true;
              default:
                if (!scan) {
                    mark_assignment_to_arguments(left);
                    return walk_lazy();
                }
                ld.assignments++;
                var fixed = ld.fixed;
                if (is_modified(compressor, tw, node, node, 0)) {
                    ld.fixed = false;
                    return walk_lazy();
                }
                var safe = safe_to_read(tw, ld);
                if (lazy) push(tw, true);
                right.walk(tw);
                if (lazy) pop(tw);
                if (safe && !left.in_arg && safe_to_assign(tw, ld)) {
                    push_ref(ld, left);
                    mark(tw, ld);
                    if (ld.single_use) ld.single_use = false;
                    left.fixed = ld.fixed = function() {
                        return make_node(AST_Binary, node, {
                            operator: node.operator.slice(0, -1),
                            left: make_ref(left, fixed),
                            right: node.right,
                        });
                    };
                    left.fixed.assigns = !fixed || !fixed.assigns ? [ ld.orig[0] ] : fixed.assigns.slice();
                    left.fixed.assigns.push(node);
                    left.fixed.to_binary = replace_ref(function(node) {
                        return node.left;
                    }, fixed);
                } else {
                    left.walk(tw);
                    ld.fixed = false;
                }
                return true;
            }

            function walk_prop(lhs) {
                reset_flags(lhs);
                if (lhs instanceof AST_Dot) {
                    walk_prop(lhs.expression);
                } else if (lhs instanceof AST_Sub) {
                    walk_prop(lhs.expression);
                    lhs.property.walk(tw);
                } else if (lhs instanceof AST_SymbolRef) {
                    var d = lhs.definition();
                    push_ref(d, lhs);
                    if (d.fixed) {
                        lhs.fixed = d.fixed;
                        if (lhs.fixed.assigns) {
                            lhs.fixed.assigns.push(node);
                        } else {
                            lhs.fixed.assigns = [ node ];
                        }
                    }
                } else {
                    lhs.walk(tw);
                }
            }

            function walk_assign() {
                var recursive = ld && recursive_ref(tw, ld);
                var modified = is_modified(compressor, tw, node, right, 0, is_immutable(right), recursive);
                scan_declaration(tw, compressor, left, function() {
                    return node.right;
                }, function(sym, fixed, walk) {
                    if (!(sym instanceof AST_SymbolRef)) {
                        mark_assignment_to_arguments(sym);
                        walk();
                        return;
                    }
                    var d = sym.definition();
                    d.assignments++;
                    if (!fixed || sym.in_arg || !safe_to_assign(tw, d)) {
                        walk();
                        d.fixed = false;
                    } else {
                        push_ref(d, sym);
                        mark(tw, d);
                        if (left instanceof AST_Destructured
                            || d.orig.length == 1 && d.orig[0] instanceof AST_SymbolDefun) {
                            d.single_use = false;
                        }
                        tw.loop_ids[d.id] = tw.in_loop;
                        d.fixed = modified ? 0 : fixed;
                        sym.fixed = fixed;
                        sym.fixed.assigns = [ node ];
                        mark_escaped(tw, d, sym.scope, node, right, 0, 1);
                    }
                });
            }

            function walk_lazy() {
                if (!lazy) return;
                left.walk(tw);
                push(tw, true);
                right.walk(tw);
                pop(tw);
                return true;
            }
        });
        def(AST_Binary, function(tw) {
            if (!lazy_op[this.operator]) return;
            this.left.walk(tw);
            push(tw, true);
            this.right.walk(tw);
            pop(tw);
            return true;
        });
        def(AST_BlockScope, function(tw, descend, compressor) {
            reset_block_variables(tw, compressor, this);
        });
        def(AST_Call, function(tw, descend) {
            var node = this;
            var exp = node.expression;
            if (exp instanceof AST_LambdaExpression) {
                var iife = is_iife_single(node);
                node.args.forEach(function(arg) {
                    arg.walk(tw);
                    if (arg instanceof AST_Spread) iife = false;
                });
                if (iife) exp.reduce_vars = reduce_iife;
                exp.walk(tw);
                if (iife) delete exp.reduce_vars;
                return true;
            }
            if (node.TYPE == "Call") switch (tw.in_boolean_context()) {
              case "d":
                var drop = true;
              case true:
                mark_refs(exp, drop);
            }
            exp.walk(tw);
            var optional = node.optional;
            if (optional) push(tw, true);
            node.args.forEach(function(arg) {
                arg.walk(tw);
            });
            if (optional) pop(tw);
            var fixed = exp instanceof AST_SymbolRef && exp.fixed_value();
            if (fixed instanceof AST_Lambda) {
                mark_fn_def(tw, exp.definition(), fixed);
            } else {
                tw.find_parent(AST_Scope).may_call_this();
            }
            return true;

            function mark_refs(node, drop) {
                if (node instanceof AST_Assign) {
                    if (node.operator != "=") return;
                    mark_refs(node.left, drop);
                    mark_refs(node.right, drop);
                } else if (node instanceof AST_Binary) {
                    if (!lazy_op[node.operator]) return;
                    mark_refs(node.left, drop);
                    mark_refs(node.right, drop);
                } else if (node instanceof AST_Conditional) {
                    mark_refs(node.consequent, drop);
                    mark_refs(node.alternative, drop);
                } else if (node instanceof AST_SymbolRef) {
                    var def = node.definition();
                    def.bool_return++;
                    if (drop) def.drop_return++;
                }
            }
        });
        def(AST_Class, function(tw, descend, compressor) {
            var node = this;
            reset_block_variables(tw, compressor, node);
            if (node.extends) node.extends.walk(tw);
            var props = node.properties.filter(function(prop) {
                reset_flags(prop);
                if (prop.key instanceof AST_Node) {
                    tw.push(prop);
                    prop.key.walk(tw);
                    tw.pop();
                }
                return prop.value;
            });
            if (node.name) {
                var d = node.name.definition();
                var parent = tw.parent();
                if (parent instanceof AST_ExportDeclaration || parent instanceof AST_ExportDefault) d.single_use = false;
                if (safe_to_assign(tw, d, true)) {
                    mark(tw, d);
                    tw.loop_ids[d.id] = tw.in_loop;
                    d.fixed = function() {
                        return node;
                    };
                    d.fixed.assigns = [ node ];
                    if (!is_safe_lexical(d)) d.single_use = false;
                } else {
                    d.fixed = false;
                }
            }
            props.forEach(function(prop) {
                tw.push(prop);
                if (!prop.static || is_static_field_or_init(prop) && prop.value.contains_this()) {
                    push(tw);
                    prop.value.walk(tw);
                    pop(tw);
                } else {
                    prop.value.walk(tw);
                }
                tw.pop();
            });
            return true;
        });
        def(AST_ClassInitBlock, function(tw, descend, compressor) {
            var node = this;
            push(tw, true);
            reset_variables(tw, compressor, node);
            descend();
            pop_scope(tw, node);
            return true;
        });
        def(AST_Conditional, function(tw) {
            this.condition.walk(tw);
            push(tw, true);
            this.consequent.walk(tw);
            pop(tw);
            push(tw, true);
            this.alternative.walk(tw);
            pop(tw);
            return true;
        });
        def(AST_DefaultValue, function(tw) {
            push(tw, true);
            this.value.walk(tw);
            pop(tw);
            this.name.walk(tw);
            return true;
        });
        def(AST_Do, function(tw) {
            var save_loop = tw.in_loop;
            tw.in_loop = this;
            push(tw);
            this.body.walk(tw);
            if (has_loop_control(this, tw.parent())) {
                pop(tw);
                push(tw);
            }
            this.condition.walk(tw);
            pop(tw);
            tw.in_loop = save_loop;
            return true;
        });
        def(AST_For, function(tw, descend, compressor) {
            var node = this;
            reset_block_variables(tw, compressor, node);
            if (node.init) node.init.walk(tw);
            var save_loop = tw.in_loop;
            tw.in_loop = node;
            push(tw);
            if (node.condition) node.condition.walk(tw);
            node.body.walk(tw);
            if (node.step) {
                if (has_loop_control(node, tw.parent())) {
                    pop(tw);
                    push(tw);
                }
                node.step.walk(tw);
            }
            pop(tw);
            tw.in_loop = save_loop;
            return true;
        });
        def(AST_ForEnumeration, function(tw, descend, compressor) {
            var node = this;
            reset_block_variables(tw, compressor, node);
            node.object.walk(tw);
            var save_loop = tw.in_loop;
            tw.in_loop = node;
            push(tw);
            var init = node.init;
            if (init instanceof AST_Definitions) {
                init.definitions[0].name.mark_symbol(function(node) {
                    if (node instanceof AST_SymbolDeclaration) {
                        var def = node.definition();
                        def.assignments++;
                        def.fixed = false;
                    }
                }, tw);
            } else if (init instanceof AST_Destructured || init instanceof AST_SymbolRef) {
                init.mark_symbol(function(node) {
                    if (node instanceof AST_SymbolRef) {
                        var def = node.definition();
                        push_ref(def, node);
                        def.assignments++;
                        if (!node.is_immutable()) def.fixed = false;
                    }
                }, tw);
            } else {
                init.walk(tw);
            }
            node.body.walk(tw);
            pop(tw);
            tw.in_loop = save_loop;
            return true;
        });
        def(AST_If, function(tw) {
            this.condition.walk(tw);
            push(tw, true);
            this.body.walk(tw);
            pop(tw);
            if (this.alternative) {
                push(tw, true);
                this.alternative.walk(tw);
                pop(tw);
            }
            return true;
        });
        def(AST_LabeledStatement, function(tw) {
            push(tw, true);
            this.body.walk(tw);
            pop(tw);
            return true;
        });
        def(AST_Lambda, function(tw, descend, compressor) {
            var fn = this;
            if (!safe_to_visit(tw, fn)) return true;
            if (!push_uniq(tw.fn_visited, fn)) return true;
            fn.inlined = false;
            push(tw);
            reset_variables(tw, compressor, fn);
            descend();
            pop_scope(tw, fn);
            if (fn.name) mark_escaped(tw, fn.name.definition(), fn, fn.name, fn, 0, 1);
            return true;
        });
        def(AST_LambdaDefinition, function(tw, descend, compressor) {
            var fn = this;
            var def = fn.name.definition();
            var parent = tw.parent();
            if (parent instanceof AST_ExportDeclaration || parent instanceof AST_ExportDefault) def.single_use = false;
            if (!safe_to_visit(tw, fn)) return true;
            if (!push_uniq(tw.fn_visited, fn)) return true;
            fn.inlined = false;
            push(tw);
            reset_variables(tw, compressor, fn);
            descend();
            pop_scope(tw, fn);
            return true;
        });
        def(AST_Sub, function(tw) {
            if (!this.optional) return;
            this.expression.walk(tw);
            push(tw, true);
            this.property.walk(tw);
            pop(tw);
            return true;
        });
        def(AST_Switch, function(tw, descend, compressor) {
            var node = this;
            reset_block_variables(tw, compressor, node);
            node.expression.walk(tw);
            var first = true;
            node.body.forEach(function(branch) {
                if (branch instanceof AST_Default) return;
                branch.expression.walk(tw);
                if (first) {
                    first = false;
                    push(tw, true);
                }
            })
            if (!first) pop(tw);
            walk_body(node, tw);
            return true;
        });
        def(AST_SwitchBranch, function(tw) {
            push(tw, true);
            walk_body(this, tw);
            pop(tw);
            return true;
        });
        def(AST_SymbolCatch, function() {
            this.definition().fixed = false;
        });
        def(AST_SymbolImport, function() {
            this.definition().fixed = false;
        });
        def(AST_SymbolRef, function(tw, descend, compressor) {
            var ref = this;
            var d = ref.definition();
            var fixed = d.fixed || d.last_ref && d.last_ref.fixed;
            push_ref(d, ref);
            if (d.references.length == 1 && !d.fixed && d.orig[0] instanceof AST_SymbolDefun) {
                tw.loop_ids[d.id] = tw.in_loop;
            }
            var recursive = recursive_ref(tw, d);
            if (recursive) recursive.enclosed.forEach(function(def) {
                if (d === def) return;
                if (def.scope.resolve() === recursive) return;
                var assigns = def.fixed && def.fixed.assigns;
                if (!assigns) return;
                if (assigns[assigns.length - 1] instanceof AST_VarDef) return;
                var safe = tw.safe_ids[def.id];
                if (!safe) return;
                safe.assign = true;
            });
            if (d.single_use == "m" && d.fixed) {
                d.fixed = 0;
                d.single_use = false;
            }
            switch (d.fixed) {
              case 0:
                if (!safe_to_read(tw, d)) d.fixed = false;
              case false:
                var redef = d.redefined();
                if (redef && cross_scope(d.scope, ref.scope)) redef.single_use = false;
                break;
              case undefined:
                d.fixed = false;
                break;
              default:
                if (!safe_to_read(tw, d)) {
                    d.fixed = false;
                    break;
                }
                if (ref.in_arg && d.orig[0] instanceof AST_SymbolLambda) ref.fixed = d.scope;
                var value = ref.fixed_value();
                if (recursive) {
                    d.recursive_refs++;
                } else if (value && ref_once(compressor, d)) {
                    d.in_loop = tw.loop_ids[d.id] !== tw.in_loop;
                    d.single_use = is_lambda(value)
                            && !value.pinned()
                            && (!d.in_loop || tw.parent() instanceof AST_Call)
                        || !d.in_loop
                            && d.scope === ref.scope.resolve()
                            && value.is_constant_expression();
                } else {
                    d.single_use = false;
                }
                if (is_modified(compressor, tw, ref, value, 0, is_immutable(value), recursive)) {
                    if (d.single_use) {
                        d.single_use = "m";
                    } else {
                        d.fixed = 0;
                    }
                }
                if (d.fixed && tw.loop_ids[d.id] !== tw.in_loop) d.cross_loop = true;
                mark_escaped(tw, d, ref.scope, ref, value, 0, 1);
                break;
            }
            if (!ref.fixed) ref.fixed = d.fixed === 0 ? fixed : d.fixed;
            var parent;
            if (value instanceof AST_Lambda
                && !((parent = tw.parent()) instanceof AST_Call && parent.expression === ref)) {
                mark_fn_def(tw, d, value);
            }
        });
        def(AST_Template, function(tw, descend) {
            var node = this;
            var tag = node.tag;
            if (!tag) return;
            if (tag instanceof AST_LambdaExpression) {
                node.expressions.forEach(function(exp) {
                    exp.walk(tw);
                });
                tag.walk(tw);
                return true;
            }
            tag.walk(tw);
            node.expressions.forEach(function(exp) {
                exp.walk(tw);
            });
            var fixed = tag instanceof AST_SymbolRef && tag.fixed_value();
            if (fixed instanceof AST_Lambda) {
                mark_fn_def(tw, tag.definition(), fixed);
            } else {
                tw.find_parent(AST_Scope).may_call_this();
            }
            return true;
        });
        def(AST_Toplevel, function(tw, descend, compressor) {
            var node = this;
            node.globals.each(function(def) {
                reset_def(tw, compressor, def);
            });
            push(tw, true);
            reset_variables(tw, compressor, node);
            descend();
            pop_scope(tw, node);
            return true;
        });
        def(AST_Try, function(tw, descend, compressor) {
            var node = this;
            reset_block_variables(tw, compressor, node);
            push(tw, true);
            walk_body(node, tw);
            pop(tw);
            if (node.bcatch) {
                push(tw, true);
                node.bcatch.walk(tw);
                pop(tw);
            }
            if (node.bfinally) node.bfinally.walk(tw);
            return true;
        });
        def(AST_Unary, function(tw, descend) {
            var node = this;
            if (!UNARY_POSTFIX[node.operator]) return;
            var exp = node.expression;
            if (!(exp instanceof AST_SymbolRef)) {
                mark_assignment_to_arguments(exp);
                return;
            }
            var d = exp.definition();
            d.assignments++;
            var fixed = d.fixed;
            if (safe_to_read(tw, d) && !exp.in_arg && safe_to_assign(tw, d)) {
                push_ref(d, exp);
                mark(tw, d);
                if (d.single_use) d.single_use = false;
                d.fixed = function() {
                    return make_node(AST_Binary, node, {
                        operator: node.operator.slice(0, -1),
                        left: make_node(AST_UnaryPrefix, node, {
                            operator: "+",
                            expression: make_ref(exp, fixed),
                        }),
                        right: make_node(AST_Number, node, { value: 1 }),
                    });
                };
                d.fixed.assigns = fixed && fixed.assigns ? fixed.assigns.slice() : [];
                d.fixed.assigns.push(node);
                if (node instanceof AST_UnaryPrefix) {
                    exp.fixed = d.fixed;
                } else {
                    exp.fixed = function() {
                        return make_node(AST_UnaryPrefix, node, {
                            operator: "+",
                            expression: make_ref(exp, fixed),
                        });
                    };
                    exp.fixed.assigns = fixed && fixed.assigns;
                    exp.fixed.to_prefix = replace_ref(function(node) {
                        return node.expression;
                    }, d.fixed);
                }
            } else {
                exp.walk(tw);
                d.fixed = false;
            }
            return true;
        });
        def(AST_VarDef, function(tw, descend, compressor) {
            var node = this;
            var value = node.value;
            if (value instanceof AST_LambdaExpression && node.name instanceof AST_SymbolDeclaration) {
                walk_defn();
                value.parent_scope.resolve().fn_defs.push(value);
                value.safe_ids = null;
                var ld = node.name.definition();
                if (!ld.fixed) mark_fn_def(tw, ld, value);
            } else if (value) {
                value.walk(tw);
                walk_defn();
            } else if (tw.parent() instanceof AST_Let) {
                walk_defn();
            }
            return true;

            function walk_defn() {
                scan_declaration(tw, compressor, node.name, function() {
                    return node.value || make_node(AST_Undefined, node);
                }, function(name, fixed) {
                    var d = name.definition();
                    if (fixed && safe_to_assign(tw, d, true)) {
                        mark(tw, d);
                        tw.loop_ids[d.id] = tw.in_loop;
                        d.fixed = fixed;
                        d.fixed.assigns = [ node ];
                        if (name instanceof AST_SymbolConst && d.redefined()
                            || !(can_drop_symbol(name) || is_safe_lexical(d))) {
                            d.single_use = false;
                        }
                    } else {
                        d.fixed = false;
                    }
                });
            }
        });
        def(AST_While, function(tw, descend) {
            var save_loop = tw.in_loop;
            tw.in_loop = this;
            push(tw);
            descend();
            pop(tw);
            tw.in_loop = save_loop;
            return true;
        });
    })(function(node, func) {
        node.DEFMETHOD("reduce_vars", func);
    });

    function reset_flags(node) {
        node._squeezed = false;
        node._optimized = false;
        if (node instanceof AST_BlockScope) node._var_names = undefined;
        if (node instanceof AST_SymbolRef) node.fixed = undefined;
    }

    AST_Toplevel.DEFMETHOD("reset_opt_flags", function(compressor) {
        var tw = new TreeWalker(compressor.option("reduce_vars") ? function(node, descend) {
            reset_flags(node);
            return node.reduce_vars(tw, descend, compressor);
        } : reset_flags);
        // Flow control for visiting lambda definitions
        tw.fn_scanning = null;
        tw.fn_visited = [];
        // Record the loop body in which `AST_SymbolDeclaration` is first encountered
        tw.in_loop = null;
        tw.loop_ids = Object.create(null);
        // Stack of look-up tables to keep track of whether a `SymbolDef` has been
        // properly assigned before use:
        // - `push()` & `pop()` when visiting conditional branches
        // - backup & restore via `save_ids` when visiting out-of-order sections
        tw.safe_ids = Object.create(null);
        tw.safe_ids.seq = {};
        this.walk(tw);
    });

    AST_Symbol.DEFMETHOD("fixed_value", function(ref_only) {
        var def = this.definition();
        var fixed = def.fixed;
        if (fixed) {
            if (this.fixed) fixed = this.fixed;
            return (fixed instanceof AST_Node ? fixed : fixed()).tail_node();
        }
        fixed = fixed === 0 && this.fixed;
        if (!fixed) return fixed;
        var value = (fixed instanceof AST_Node ? fixed : fixed()).tail_node();
        if (ref_only && def.escaped.depth != 1 && is_object(value, true)) return value;
        if (value.is_constant()) return value;
    });

    AST_SymbolRef.DEFMETHOD("is_immutable", function() {
        var def = this.redef || this.definition();
        if (!(def.orig[0] instanceof AST_SymbolLambda)) return false;
        if (def.orig.length == 1) return true;
        if (!this.in_arg) return false;
        return !(def.orig[1] instanceof AST_SymbolFunarg);
    });

    AST_Node.DEFMETHOD("convert_symbol", noop);
    function convert_destructured(type, process) {
        return this.transform(new TreeTransformer(function(node, descend) {
            if (node instanceof AST_DefaultValue) {
                node = node.clone();
                node.name = node.name.transform(this);
                return node;
            }
            if (node instanceof AST_Destructured) {
                node = node.clone();
                descend(node, this);
                return node;
            }
            if (node instanceof AST_DestructuredKeyVal) {
                node = node.clone();
                node.value = node.value.transform(this);
                return node;
            }
            return node.convert_symbol(type, process);
        }));
    }
    AST_DefaultValue.DEFMETHOD("convert_symbol", convert_destructured);
    AST_Destructured.DEFMETHOD("convert_symbol", convert_destructured);
    function convert_symbol(type, process) {
        var node = make_node(type, this);
        return process(node, this) || node;
    }
    AST_SymbolDeclaration.DEFMETHOD("convert_symbol", convert_symbol);
    AST_SymbolRef.DEFMETHOD("convert_symbol", convert_symbol);

    function process_to_assign(ref) {
        var def = ref.definition();
        def.assignments++;
        def.references.push(ref);
    }

    function mark_destructured(process, tw) {
        var marker = new TreeWalker(function(node) {
            if (node instanceof AST_DefaultValue) {
                node.value.walk(tw);
                node.name.walk(marker);
                return true;
            }
            if (node instanceof AST_DestructuredKeyVal) {
                if (node.key instanceof AST_Node) node.key.walk(tw);
                node.value.walk(marker);
                return true;
            }
            return process(node);
        });
        this.walk(marker);
    }
    AST_DefaultValue.DEFMETHOD("mark_symbol", mark_destructured);
    AST_Destructured.DEFMETHOD("mark_symbol", mark_destructured);
    function mark_symbol(process) {
        return process(this);
    }
    AST_SymbolDeclaration.DEFMETHOD("mark_symbol", mark_symbol);
    AST_SymbolRef.DEFMETHOD("mark_symbol", mark_symbol);

    AST_Node.DEFMETHOD("match_symbol", function(predicate) {
        return predicate(this);
    });
    function match_destructured(predicate, ignore_side_effects) {
        var found = false;
        var tw = new TreeWalker(function(node) {
            if (found) return true;
            if (node instanceof AST_DefaultValue) {
                if (!ignore_side_effects) return found = true;
                node.name.walk(tw);
                return true;
            }
            if (node instanceof AST_DestructuredKeyVal) {
                if (!ignore_side_effects && node.key instanceof AST_Node) return found = true;
                node.value.walk(tw);
                return true;
            }
            if (predicate(node)) return found = true;
        });
        this.walk(tw);
        return found;
    }
    AST_DefaultValue.DEFMETHOD("match_symbol", match_destructured);
    AST_Destructured.DEFMETHOD("match_symbol", match_destructured);

    function in_async_generator(scope) {
        return scope instanceof AST_AsyncGeneratorDefun || scope instanceof AST_AsyncGeneratorFunction;
    }

    function find_scope(compressor) {
        var level = 0, node = compressor.self();
        do {
            if (node.variables) return node;
        } while (node = compressor.parent(level++));
    }

    function find_try(compressor, level, node, scope, may_throw, sync) {
        for (var parent; parent = compressor.parent(level++); node = parent) {
            if (parent === scope) return false;
            if (sync && parent instanceof AST_Lambda) {
                if (parent.name || is_async(parent) || is_generator(parent)) return true;
            } else if (parent instanceof AST_Try) {
                if (parent.bfinally && parent.bfinally !== node) return true;
                if (may_throw && parent.bcatch && parent.bcatch !== node) return true;
            }
        }
        return false;
    }

    var identifier_atom = makePredicate("Infinity NaN undefined");
    function is_lhs_read_only(lhs, compressor) {
        if (lhs instanceof AST_Atom) return true;
        if (lhs instanceof AST_ObjectIdentity) return true;
        if (lhs instanceof AST_PropAccess) {
            if (lhs.property === "__proto__") return true;
            lhs = lhs.expression;
            if (lhs instanceof AST_SymbolRef) {
                if (lhs.is_immutable()) return false;
                lhs = lhs.fixed_value();
            }
            if (!lhs) return true;
            if (lhs.tail_node().is_constant()) return true;
            return is_lhs_read_only(lhs, compressor);
        }
        if (lhs instanceof AST_SymbolRef) {
            if (lhs.is_immutable()) return true;
            var def = lhs.definition();
            return compressor.exposed(def) && identifier_atom[def.name];
        }
        return false;
    }

    function make_node(ctor, orig, props) {
        if (props) {
            props.start = orig.start;
            props.end = orig.end;
        } else {
            props = orig;
        }
        return new ctor(props);
    }

    function make_sequence(orig, expressions) {
        if (expressions.length == 1) return expressions[0];
        return make_node(AST_Sequence, orig, { expressions: expressions.reduce(merge_sequence, []) });
    }

    function make_node_from_constant(val, orig) {
        switch (typeof val) {
          case "string":
            return make_node(AST_String, orig, { value: val });
          case "number":
            if (isNaN(val)) return make_node(AST_NaN, orig);
            if (isFinite(val)) {
                return 1 / val < 0 ? make_node(AST_UnaryPrefix, orig, {
                    operator: "-",
                    expression: make_node(AST_Number, orig, { value: -val }),
                }) : make_node(AST_Number, orig, { value: val });
            }
            return val < 0 ? make_node(AST_UnaryPrefix, orig, {
                operator: "-",
                expression: make_node(AST_Infinity, orig),
            }) : make_node(AST_Infinity, orig);
          case "boolean":
            return make_node(val ? AST_True : AST_False, orig);
          case "undefined":
            return make_node(AST_Undefined, orig);
          default:
            if (val === null) {
                return make_node(AST_Null, orig);
            }
            if (val instanceof RegExp) {
                return make_node(AST_RegExp, orig, { value: val });
            }
            throw new Error(string_template("Can't handle constant of type: {type}", { type: typeof val }));
        }
    }

    function needs_unbinding(val) {
        return val instanceof AST_PropAccess
            || is_undeclared_ref(val) && val.name == "eval";
    }

    // we shouldn't compress (1,func)(something) to
    // func(something) because that changes the meaning of
    // the func (becomes lexical instead of global).
    function maintain_this_binding(parent, orig, val) {
        var wrap = false;
        if (parent.TYPE == "Call") {
            wrap = parent.expression === orig && needs_unbinding(val);
        } else if (parent instanceof AST_Template) {
            wrap = parent.tag === orig && needs_unbinding(val);
        } else if (parent instanceof AST_UnaryPrefix) {
            wrap = parent.operator == "delete"
                || parent.operator == "typeof" && is_undeclared_ref(val);
        }
        return wrap ? make_sequence(orig, [ make_node(AST_Number, orig, { value: 0 }), val ]) : val;
    }

    function merge_expression(base, target) {
        var fixed_by_id = new Dictionary();
        base.walk(new TreeWalker(function(node) {
            if (!(node instanceof AST_SymbolRef)) return;
            var def = node.definition();
            var fixed = node.fixed;
            if (!fixed || !fixed_by_id.has(def.id)) {
                fixed_by_id.set(def.id, fixed);
            } else if (fixed_by_id.get(def.id) !== fixed) {
                fixed_by_id.set(def.id, false);
            }
        }));
        if (fixed_by_id.size() > 0) target.walk(new TreeWalker(function(node) {
            if (!(node instanceof AST_SymbolRef)) return;
            var def = node.definition();
            var fixed = node.fixed;
            if (!fixed || !fixed_by_id.has(def.id)) return;
            if (fixed_by_id.get(def.id) !== fixed) node.fixed = false;
        }));
        return target;
    }

    function merge_sequence(array, node) {
        if (node instanceof AST_Sequence) {
            [].push.apply(array, node.expressions);
        } else {
            array.push(node);
        }
        return array;
    }

    function is_lexical_definition(stat) {
        return stat instanceof AST_Const || stat instanceof AST_DefClass || stat instanceof AST_Let;
    }

    function safe_to_trim(stat) {
        if (stat instanceof AST_LambdaDefinition) {
            var def = stat.name.definition();
            var scope = stat.name.scope;
            return def.scope === scope || all(def.references, function(ref) {
                var s = ref.scope;
                do {
                    if (s === scope) return true;
                } while (s = s.parent_scope);
            });
        }
        return !is_lexical_definition(stat);
    }

    function as_statement_array(thing) {
        if (thing === null) return [];
        if (thing instanceof AST_BlockStatement) return all(thing.body, safe_to_trim) ? thing.body : [ thing ];
        if (thing instanceof AST_EmptyStatement) return [];
        if (is_statement(thing)) return [ thing ];
        throw new Error("Can't convert thing to statement array");
    }

    function is_empty(thing) {
        if (thing === null) return true;
        if (thing instanceof AST_EmptyStatement) return true;
        if (thing instanceof AST_BlockStatement) return thing.body.length == 0;
        return false;
    }

    function has_declarations_only(block) {
        return all(block.body, function(stat) {
            return is_empty(stat)
                || stat instanceof AST_Defun
                || stat instanceof AST_Var && declarations_only(stat);
        });
    }

    function loop_body(x) {
        if (x instanceof AST_IterationStatement) {
            return x.body instanceof AST_BlockStatement ? x.body : x;
        }
        return x;
    }

    function is_iife_call(node) {
        if (node.TYPE != "Call") return false;
        do {
            node = node.expression;
        } while (node instanceof AST_PropAccess);
        return node instanceof AST_LambdaExpression ? !is_arrow(node) : is_iife_call(node);
    }

    function is_iife_single(call) {
        var exp = call.expression;
        if (exp.name) return false;
        if (!(call instanceof AST_New)) return true;
        var found = false;
        exp.walk(new TreeWalker(function(node) {
            if (found) return true;
            if (node instanceof AST_NewTarget) return found = true;
            if (node instanceof AST_Scope && node !== exp) return true;
        }));
        return !found;
    }

    function is_undeclared_ref(node) {
        return node instanceof AST_SymbolRef && node.definition().undeclared;
    }

    var global_names = makePredicate("Array Boolean clearInterval clearTimeout console Date decodeURI decodeURIComponent encodeURI encodeURIComponent Error escape eval EvalError Function isFinite isNaN JSON Map Math Number parseFloat parseInt RangeError ReferenceError RegExp Object Set setInterval setTimeout String SyntaxError TypeError unescape URIError WeakMap WeakSet");
    AST_SymbolRef.DEFMETHOD("is_declared", function(compressor) {
        return this.defined
            || !this.definition().undeclared
            || compressor.option("unsafe") && global_names[this.name];
    });

    function is_static_field_or_init(prop) {
        return prop.static && prop.value && (prop instanceof AST_ClassField || prop instanceof AST_ClassInit);
    }

    function declarations_only(node) {
        return all(node.definitions, function(var_def) {
            return !var_def.value;
        });
    }

    function is_declaration(stat, lexical) {
        if (stat instanceof AST_DefClass) return lexical && !stat.extends && all(stat.properties, function(prop) {
            if (prop.key instanceof AST_Node) return false;
            return !is_static_field_or_init(prop);
        });
        if (stat instanceof AST_Definitions) return (lexical || stat instanceof AST_Var) && declarations_only(stat);
        if (stat instanceof AST_ExportDeclaration) return is_declaration(stat.body, lexical);
        if (stat instanceof AST_ExportDefault) return is_declaration(stat.body, lexical);
        return stat instanceof AST_LambdaDefinition;
    }

    function is_last_statement(body, stat) {
        var index = body.lastIndexOf(stat);
        if (index < 0) return false;
        while (++index < body.length) {
            if (!is_declaration(body[index], true)) return false;
        }
        return true;
    }

    // Certain combination of unused name + side effect leads to invalid AST:
    //    https://github.com/mishoo/UglifyJS/issues/44
    //    https://github.com/mishoo/UglifyJS/issues/1838
    //    https://github.com/mishoo/UglifyJS/issues/3371
    // We fix it at this stage by moving the `var` outside the `for`.
    function patch_for_init(node, in_list) {
        var block;
        if (node.init instanceof AST_BlockStatement) {
            block = node.init;
            node.init = block.body.pop();
            block.body.push(node);
        }
        if (node.init instanceof AST_Defun) {
            if (!block) block = make_node(AST_BlockStatement, node, { body: [ node ] });
            block.body.splice(-1, 0, node.init);
            node.init = null;
        } else if (node.init instanceof AST_SimpleStatement) {
            node.init = node.init.body;
        } else if (is_empty(node.init)) {
            node.init = null;
        }
        if (!block) return;
        return in_list ? List.splice(block.body) : block;
    }

    function tighten_body(statements, compressor) {
        var in_lambda = last_of(compressor, function(node) {
            return node instanceof AST_Lambda;
        });
        var block_scope, iife_in_try, in_iife_single, in_loop, in_try, scope;
        find_loop_scope_try();
        var changed, last_changed, max_iter = 10;
        do {
            last_changed = changed;
            changed = 0;
            if (eliminate_spurious_blocks(statements)) changed = 1;
            if (!changed && last_changed == 1) break;
            if (compressor.option("dead_code")) {
                if (eliminate_dead_code(statements, compressor)) changed = 2;
                if (!changed && last_changed == 2) break;
            }
            if (compressor.option("if_return")) {
                if (handle_if_return(statements, compressor)) changed = 3;
                if (!changed && last_changed == 3) break;
            }
            if (compressor.option("awaits") && compressor.option("side_effects")) {
                if (trim_awaits(statements, compressor)) changed = 4;
                if (!changed && last_changed == 4) break;
            }
            if (compressor.option("inline") >= 4) {
                if (inline_iife(statements, compressor)) changed = 5;
                if (!changed && last_changed == 5) break;
            }
            if (compressor.sequences_limit > 0) {
                if (sequencesize(statements, compressor)) changed = 6;
                if (!changed && last_changed == 6) break;
                if (sequencesize_2(statements, compressor)) changed = 7;
                if (!changed && last_changed == 7) break;
            }
            if (compressor.option("join_vars")) {
                if (join_consecutive_vars(statements)) changed = 8;
                if (!changed && last_changed == 8) break;
            }
            if (compressor.option("collapse_vars")) {
                if (collapse(statements, compressor)) changed = 9;
            }
        } while (changed && max_iter-- > 0);
        return statements;

        function last_of(compressor, predicate) {
            var block = compressor.self(), level = 0, stat;
            do {
                if (block instanceof AST_Catch) {
                    block = compressor.parent(level++);
                } else if (block instanceof AST_LabeledStatement) {
                    block = block.body;
                } else if (block instanceof AST_SwitchBranch) {
                    var branches = compressor.parent(level);
                    if (branches.body[branches.body.length - 1] === block || has_break(block.body)) {
                        level++;
                        block = branches;
                    }
                }
                do {
                    stat = block;
                    if (predicate(stat)) return stat;
                    block = compressor.parent(level++);
                } while (block instanceof AST_If);
            } while (stat
                && (block instanceof AST_BlockStatement
                    || block instanceof AST_Catch
                    || block instanceof AST_Scope
                    || block instanceof AST_SwitchBranch
                    || block instanceof AST_Try)
                && is_last_statement(block.body, stat));

            function has_break(stats) {
                for (var i = stats.length; --i >= 0;) {
                    if (stats[i] instanceof AST_Break) return true;
                }
                return false;
            }
        }

        function find_loop_scope_try() {
            var node = compressor.self(), level = 0;
            do {
                if (!block_scope && node.variables) block_scope = node;
                if (node instanceof AST_Catch) {
                    if (compressor.parent(level).bfinally) {
                        if (!in_try) in_try = {};
                        in_try.bfinally = true;
                    }
                    level++;
                } else if (node instanceof AST_Finally) {
                    level++;
                } else if (node instanceof AST_IterationStatement) {
                    in_loop = true;
                } else if (node instanceof AST_Scope) {
                    scope = node;
                    break;
                } else if (node instanceof AST_Try) {
                    if (!in_try) in_try = {};
                    if (node.bcatch) in_try.bcatch = true;
                    if (node.bfinally) in_try.bfinally = true;
                }
            } while (node = compressor.parent(level++));
        }

        // Search from right to left for assignment-like expressions:
        // - `var a = x;`
        // - `a = x;`
        // - `++a`
        // For each candidate, scan from left to right for first usage, then try
        // to fold assignment into the site for compression.
        // Will not attempt to collapse assignments into or past code blocks
        // which are not sequentially executed, e.g. loops and conditionals.
        function collapse(statements, compressor) {
            if (scope.pinned()) return;
            var args;
            var assignments = new Dictionary();
            var candidates = [];
            var changed = false;
            var declare_only = new Dictionary();
            var force_single;
            var stat_index = statements.length;
            var scanner = new TreeTransformer(function(node, descend) {
                if (abort) return node;
                // Skip nodes before `candidate` as quickly as possible
                if (!hit) {
                    if (node !== hit_stack[hit_index]) return node;
                    hit_index++;
                    if (hit_index < hit_stack.length) return handle_custom_scan_order(node, scanner);
                    hit = true;
                    stop_after = (value_def ? find_stop_value : find_stop)(node, 0);
                    if (stop_after === node) abort = true;
                    return node;
                }
                var parent = scanner.parent();
                // Stop only if candidate is found within conditional branches
                if (!stop_if_hit && in_conditional(node, parent)) {
                    stop_if_hit = parent;
                }
                // Cascade compound assignments
                if (compound && scan_lhs && can_replace && !stop_if_hit
                    && node instanceof AST_Assign && node.operator != "=" && node.left.equals(lhs)) {
                    replaced++;
                    changed = true;
                    AST_Node.info("Cascading {this} [{start}]", node);
                    can_replace = false;
                    lvalues = get_lvalues(lhs);
                    node.right.transform(scanner);
                    clear_write_only(candidate);
                    var folded;
                    if (abort) {
                        folded = candidate;
                    } else {
                        abort = true;
                        folded = make_node(AST_Binary, candidate, {
                            operator: compound,
                            left: lhs.fixed && lhs.definition().fixed ? lhs.fixed.to_binary(candidate) : lhs,
                            right: rvalue,
                        });
                    }
                    return make_node(AST_Assign, node, {
                        operator: "=",
                        left: node.left,
                        right: make_node(AST_Binary, node, {
                            operator: node.operator.slice(0, -1),
                            left: folded,
                            right: node.right,
                        }),
                    });
                }
                // Stop immediately if these node types are encountered
                if (should_stop(node, parent)) {
                    abort = true;
                    return node;
                }
                // Skip transient nodes caused by single-use variable replacement
                if (node.single_use) return node;
                // Replace variable with assignment when found
                var hit_rhs;
                if (!(node instanceof AST_SymbolDeclaration)
                    && (scan_lhs && lhs.equals(node)
                        || scan_rhs && (hit_rhs = scan_rhs(node, this)))) {
                    if (!can_replace || stop_if_hit && (hit_rhs || !lhs_local || !replace_all)) {
                        if (!hit_rhs && !value_def) abort = true;
                        return node;
                    }
                    if (is_lhs(node, parent)) {
                        if (value_def && !hit_rhs) assign_used = true;
                        return node;
                    }
                    if (!hit_rhs && verify_ref && node.fixed !== lhs.fixed) {
                        abort = true;
                        return node;
                    }
                    if (value_def) {
                        if (stop_if_hit && assign_pos == 0) assign_pos = remaining - replaced;
                        if (!hit_rhs) replaced++;
                        return node;
                    }
                    replaced++;
                    changed = abort = true;
                    AST_Node.info("Collapsing {this} [{start}]", node);
                    if (candidate.TYPE == "Binary") {
                        update_symbols(candidate, node);
                        return make_node(AST_Assign, candidate, {
                            operator: "=",
                            left: candidate.right.left,
                            right: candidate.operator == "&&" ? make_node(AST_Conditional, candidate, {
                                condition: candidate.left,
                                consequent: candidate.right.right,
                                alternative: node,
                            }) : make_node(AST_Conditional, candidate, {
                                condition: candidate.left,
                                consequent: node,
                                alternative: candidate.right.right,
                            }),
                        });
                    }
                    if (candidate instanceof AST_UnaryPostfix) return make_node(AST_UnaryPrefix, candidate, {
                        operator: candidate.operator,
                        expression: lhs.fixed && lhs.definition().fixed ? lhs.fixed.to_prefix(candidate) : lhs,
                    });
                    if (candidate instanceof AST_UnaryPrefix) {
                        clear_write_only(candidate);
                        return candidate;
                    }
                    update_symbols(rvalue, node);
                    if (candidate instanceof AST_VarDef) {
                        var def = candidate.name.definition();
                        if (def.references.length - def.replaced == 1 && !compressor.exposed(def)) {
                            def.replaced++;
                            return maintain_this_binding(parent, node, rvalue);
                        }
                        return make_node(AST_Assign, candidate, {
                            operator: "=",
                            left: node,
                            right: rvalue,
                        });
                    }
                    clear_write_only(rvalue);
                    var assign = candidate.clone();
                    assign.right = rvalue;
                    return assign;
                }
                // Stop signals related to AST_SymbolRef
                if (should_stop_ref(node, parent)) {
                    abort = true;
                    return node;
                }
                // These node types have child nodes that execute sequentially,
                // but are otherwise not safe to scan into or beyond them.
                if (is_last_node(node, parent) || may_throw(node)) {
                    stop_after = node;
                    if (node instanceof AST_Scope) abort = true;
                }
                // Scan but don't replace inside getter/setter
                if (node instanceof AST_Accessor) {
                    var replace = can_replace;
                    can_replace = false;
                    descend(node, scanner);
                    can_replace = replace;
                    return signal_abort(node);
                }
                // Scan but don't replace inside destructuring expression
                if (node instanceof AST_Destructured) {
                    var replace = can_replace;
                    can_replace = false;
                    descend(node, scanner);
                    can_replace = replace;
                    return signal_abort(node);
                }
                // Scan but don't replace inside default value
                if (node instanceof AST_DefaultValue) {
                    node.name = node.name.transform(scanner);
                    var replace = can_replace;
                    can_replace = false;
                    node.value = node.value.transform(scanner);
                    can_replace = replace;
                    return signal_abort(node);
                }
                // Scan but don't replace inside block scope with colliding variable
                if (node instanceof AST_BlockScope
                    && !(node instanceof AST_Scope)
                    && !(node.variables && node.variables.all(function(def) {
                        return !enclosed.has(def.name) && !lvalues.has(def.name);
                    }))) {
                    var replace = can_replace;
                    can_replace = false;
                    if (!handle_custom_scan_order(node, scanner)) descend(node, scanner);
                    can_replace = replace;
                    return signal_abort(node);
                }
                if (handle_custom_scan_order(node, scanner)) return signal_abort(node);
            }, signal_abort);
            var multi_replacer = new TreeTransformer(function(node) {
                if (abort) return node;
                // Skip nodes before `candidate` as quickly as possible
                if (!hit) {
                    if (node !== hit_stack[hit_index]) return node;
                    hit_index++;
                    switch (hit_stack.length - hit_index) {
                      case 0:
                        hit = true;
                        if (assign_used) return node;
                        if (node !== candidate) return node;
                        if (node instanceof AST_VarDef) return node;
                        def.replaced++;
                        var parent = multi_replacer.parent();
                        if (parent instanceof AST_Sequence && parent.tail_node() !== node) {
                            value_def.replaced++;
                            if (rvalue === rhs_value) return List.skip;
                            return make_sequence(rhs_value, rhs_value.expressions.slice(0, -1));
                        }
                        return rvalue;
                      case 1:
                        if (!assign_used && node.body === candidate) {
                            hit = true;
                            def.replaced++;
                            value_def.replaced++;
                            return null;
                        }
                      default:
                        return handle_custom_scan_order(node, multi_replacer);
                    }
                }
                // Replace variable when found
                if (node instanceof AST_SymbolRef && node.definition() === def) {
                    if (is_lhs(node, multi_replacer.parent())) return node;
                    if (!--replaced) abort = true;
                    AST_Node.info("Replacing {this} [{start}]", node);
                    var ref = rvalue.clone();
                    ref.scope = node.scope;
                    ref.reference();
                    if (replaced == assign_pos) {
                        abort = true;
                        return make_node(AST_Assign, candidate, {
                            operator: "=",
                            left: node,
                            right: ref,
                        });
                    }
                    def.replaced++;
                    return ref;
                }
                // Skip (non-executed) functions and (leading) default case in switch statements
                if (node instanceof AST_Default || node instanceof AST_Scope) return node;
            }, function(node) {
                return patch_sequence(node, multi_replacer);
            });
            while (--stat_index >= 0) {
                // Treat parameters as collapsible in IIFE, i.e.
                //   function(a, b){ ... }(x());
                // would be translated into equivalent assignments:
                //   var a = x(), b = undefined;
                if (stat_index == 0 && compressor.option("unused")) extract_args();
                // Find collapsible assignments
                var hit_stack = [];
                extract_candidates(statements[stat_index]);
                while (candidates.length > 0) {
                    hit_stack = candidates.pop();
                    var hit_index = 0;
                    var candidate = hit_stack[hit_stack.length - 1];
                    var assign_pos = -1;
                    var assign_used = false;
                    var verify_ref = false;
                    var remaining;
                    var value_def = null;
                    var stop_after = null;
                    var stop_if_hit = null;
                    var lhs = get_lhs(candidate);
                    var side_effects = lhs && lhs.has_side_effects(compressor);
                    var scan_lhs = lhs && (!side_effects || lhs instanceof AST_SymbolRef)
                            && !is_lhs_read_only(lhs, compressor);
                    var scan_rhs = foldable(candidate);
                    if (!scan_lhs && !scan_rhs) continue;
                    var compound = candidate instanceof AST_Assign && candidate.operator.slice(0, -1);
                    var funarg = candidate.name instanceof AST_SymbolFunarg;
                    var may_throw = return_false;
                    if (candidate.may_throw(compressor)) {
                        if (funarg && is_async(scope)) continue;
                        may_throw = in_try ? function(node) {
                            return node.has_side_effects(compressor);
                        } : side_effects_external;
                    }
                    var read_toplevel = false;
                    var modify_toplevel = false;
                    // Locate symbols which may execute code outside of scanning range
                    var enclosed = new Dictionary();
                    var well_defined = true;
                    var lvalues = get_lvalues(candidate);
                    var lhs_local = is_lhs_local(lhs);
                    var rhs_value = get_rvalue(candidate);
                    var rvalue = rhs_value;
                    if (!side_effects) {
                        if (!compound && rvalue instanceof AST_Sequence) rvalue = rvalue.tail_node();
                        side_effects = value_has_side_effects();
                    }
                    var check_destructured = in_try || !lhs_local ? function(node) {
                        return node instanceof AST_Destructured;
                    } : return_false;
                    var replace_all = replace_all_symbols(candidate);
                    var hit = funarg;
                    var abort = false;
                    var replaced = 0;
                    var can_replace = !args || !hit;
                    if (!can_replace) {
                        for (var j = candidate.arg_index + 1; !abort && j < args.length; j++) {
                            if (args[j]) args[j].transform(scanner);
                        }
                        can_replace = true;
                    }
                    for (var i = stat_index; !abort && i < statements.length; i++) {
                        statements[i].transform(scanner);
                    }
                    if (value_def) {
                        if (!replaced || remaining > replaced + assign_used) {
                            candidates.push(hit_stack);
                            force_single = true;
                            continue;
                        }
                        if (replaced == assign_pos) assign_used = true;
                        var def = lhs.definition();
                        abort = false;
                        hit_index = 0;
                        hit = funarg;
                        for (var i = stat_index; !abort && i < statements.length; i++) {
                            if (!statements[i].transform(multi_replacer)) statements.splice(i--, 1);
                        }
                        replaced = candidate instanceof AST_VarDef
                            && candidate === hit_stack[hit_stack.length - 1]
                            && def.references.length == def.replaced
                            && !compressor.exposed(def);
                        value_def.last_ref = false;
                        value_def.single_use = false;
                        changed = true;
                    }
                    if (replaced) remove_candidate(candidate);
                }
            }
            return changed;

            function signal_abort(node) {
                if (abort) return node;
                if (stop_after === node) abort = true;
                if (stop_if_hit === node) stop_if_hit = null;
                return node;
            }

            function handle_custom_scan_order(node, tt) {
                if (!(node instanceof AST_BlockScope)) return;
                // Skip (non-executed) functions
                if (node instanceof AST_Scope) return node;
                // Scan computed keys, static fields & initializers in class
                if (node instanceof AST_Class) {
                    if (node.name) node.name = node.name.transform(tt);
                    if (!abort && node.extends) node.extends = node.extends.transform(tt);
                    var fields = [], stats = [];
                    for (var i = 0; !abort && i < node.properties.length; i++) {
                        var prop = node.properties[i];
                        if (prop.key instanceof AST_Node) prop.key = prop.key.transform(tt);
                        if (!prop.static) continue;
                        if (prop instanceof AST_ClassField) {
                            if (prop.value) fields.push(prop);
                        } else if (prop instanceof AST_ClassInit) {
                            [].push.apply(stats, prop.value.body);
                        }
                    }
                    for (var i = 0; !abort && i < stats.length; i++) {
                        stats[i].transform(tt);
                    }
                    for (var i = 0; !abort && i < fields.length; i++) {
                        var prop = fields[i];
                        prop.value = prop.value.transform(tt);
                    }
                    return node;
                }
                // Scan object only in a for-in/of statement
                if (node instanceof AST_ForEnumeration) {
                    node.object = node.object.transform(tt);
                    abort = true;
                    return node;
                }
                // Scan first case expression only in a switch statement
                if (node instanceof AST_Switch) {
                    node.expression = node.expression.transform(tt);
                    for (var i = 0; !abort && i < node.body.length; i++) {
                        var branch = node.body[i];
                        if (branch instanceof AST_Case) {
                            if (!hit) {
                                if (branch !== hit_stack[hit_index]) continue;
                                hit_index++;
                            }
                            branch.expression = branch.expression.transform(tt);
                            if (!replace_all) break;
                            scan_rhs = false;
                        }
                    }
                    abort = true;
                    return node;
                }
            }

            function is_direct_assignment(node, parent) {
                if (parent instanceof AST_Assign) return parent.operator == "=" && parent.left === node;
                if (parent instanceof AST_DefaultValue) return parent.name === node;
                if (parent instanceof AST_DestructuredArray) return true;
                if (parent instanceof AST_DestructuredKeyVal) return parent.value === node;
            }

            function should_stop(node, parent) {
                if (node === rvalue) return true;
                if (parent instanceof AST_For) {
                    if (node !== parent.init) return true;
                }
                if (node instanceof AST_Assign) {
                    return node.operator != "=" && lhs.equals(node.left);
                }
                if (node instanceof AST_Call) {
                    if (!(lhs instanceof AST_PropAccess)) return false;
                    if (!lhs.equals(node.expression)) return false;
                    return !(rvalue instanceof AST_LambdaExpression && !rvalue.contains_this());
                }
                if (node instanceof AST_Class) return !compressor.has_directive("use strict");
                if (node instanceof AST_Debugger) return true;
                if (node instanceof AST_Defun) return funarg && lhs.name === node.name.name;
                if (node instanceof AST_DestructuredKeyVal) return node.key instanceof AST_Node;
                if (node instanceof AST_DWLoop) return true;
                if (node instanceof AST_LoopControl) return true;
                if (node instanceof AST_Try) return true;
                if (node instanceof AST_With) return true;
                return false;
            }

            function should_stop_ref(node, parent) {
                if (!(node instanceof AST_SymbolRef)) return false;
                if (node.is_declared(compressor)) {
                    if (node.fixed_value()) return false;
                    if (can_drop_symbol(node)) {
                        return !(parent instanceof AST_PropAccess && parent.expression === node)
                            && is_arguments(node.definition());
                    }
                } else if (is_direct_assignment(node, parent)) {
                    return false;
                }
                if (!replace_all) return true;
                scan_rhs = false;
                return false;
            }

            function in_conditional(node, parent) {
                if (parent instanceof AST_Assign) return parent.left !== node && lazy_op[parent.operator.slice(0, -1)];
                if (parent instanceof AST_Binary) return parent.left !== node && lazy_op[parent.operator];
                if (parent instanceof AST_Call) return parent.optional && parent.expression !== node;
                if (parent instanceof AST_Case) return parent.expression !== node;
                if (parent instanceof AST_Conditional) return parent.condition !== node;
                if (parent instanceof AST_If) return parent.condition !== node;
                if (parent instanceof AST_Sub) return parent.optional && parent.expression !== node;
            }

            function is_last_node(node, parent) {
                if (node instanceof AST_Await) return true;
                if (node.TYPE == "Binary") return !can_drop_op(node.operator, node.right, compressor);
                if (node instanceof AST_Call) {
                    var def, fn = node.expression;
                    if (fn instanceof AST_SymbolRef) {
                        def = fn.definition();
                        fn = fn.fixed_value();
                    }
                    if (!(fn instanceof AST_Lambda)) return !node.is_expr_pure(compressor);
                    if (def && recursive_ref(compressor, def, fn)) return true;
                    if (fn.collapse_scanning) return false;
                    fn.collapse_scanning = true;
                    var replace = can_replace;
                    can_replace = false;
                    var after = stop_after;
                    var if_hit = stop_if_hit;
                    for (var i = 0; !abort && i < fn.argnames.length; i++) {
                        if (arg_may_throw(reject, fn.argnames[i], node.args[i])) abort = true;
                    }
                    if (!abort) {
                        if (fn.rest && arg_may_throw(reject, fn.rest, make_node(AST_Array, node, {
                            elements: node.args.slice(i),
                        }))) {
                            abort = true;
                        } else if (is_arrow(fn) && fn.value) {
                            fn.value.transform(scanner);
                        } else for (var i = 0; !abort && i < fn.body.length; i++) {
                            var stat = fn.body[i];
                            if (stat instanceof AST_Return) {
                                if (stat.value) stat.value.transform(scanner);
                                break;
                            }
                            stat.transform(scanner);
                        }
                    }
                    stop_if_hit = if_hit;
                    stop_after = after;
                    can_replace = replace;
                    fn.collapse_scanning = false;
                    if (!abort) return false;
                    abort = false;
                    return true;
                }
                if (node instanceof AST_Class) {
                    if (!in_try) return false;
                    var base = node.extends;
                    if (!base) return false;
                    if (base instanceof AST_SymbolRef) base = base.fixed_value();
                    return !safe_for_extends(base);
                }
                if (node instanceof AST_Exit) {
                    if (in_try) {
                        if (in_try.bfinally) return true;
                        if (in_try.bcatch && node instanceof AST_Throw) return true;
                    }
                    return side_effects || lhs instanceof AST_PropAccess || may_modify(lhs);
                }
                if (node instanceof AST_Function) {
                    return compressor.option("ie") && node.name && lvalues.has(node.name.name);
                }
                if (node instanceof AST_ObjectIdentity) return symbol_in_lvalues(node, parent);
                if (node instanceof AST_PropAccess) {
                    if (side_effects) return true;
                    var exp = node.expression;
                    if (exp instanceof AST_SymbolRef && is_arguments(exp.definition())) return true;
                    if (compressor.option("unsafe")) {
                        if (is_undeclared_ref(exp) && global_names[exp.name]) return false;
                        if (is_static_fn(exp)) return false;
                    }
                    if (!well_defined) return true;
                    if (value_def) return false;
                    if (!in_try && lhs_local) return false;
                    if (node.optional) return false;
                    return exp.may_throw_on_access(compressor);
                }
                if (node instanceof AST_Spread) return true;
                if (node instanceof AST_SymbolRef) {
                    if (symbol_in_lvalues(node, parent)) return !is_direct_assignment(node, parent);
                    if (side_effects && may_modify(node)) return true;
                    var def = node.definition();
                    return (in_try || def.scope.resolve() !== scope) && !can_drop_symbol(node);
                }
                if (node instanceof AST_Template) return !node.is_expr_pure(compressor);
                if (node instanceof AST_VarDef) {
                    if (check_destructured(node.name)) return true;
                    return (node.value || parent instanceof AST_Let) && node.name.match_symbol(function(node) {
                        return node instanceof AST_SymbolDeclaration
                            && (lvalues.has(node.name) || side_effects && may_modify(node));
                    }, true);
                }
                if (node instanceof AST_Yield) return true;
                var sym = is_lhs(node.left, node);
                if (!sym) return false;
                if (sym instanceof AST_PropAccess) return true;
                if (check_destructured(sym)) return true;
                return sym.match_symbol(function(node) {
                    return node instanceof AST_SymbolRef
                        && (lvalues.has(node.name) || read_toplevel && compressor.exposed(node.definition()));
                }, true);

                function reject(node) {
                    node.transform(scanner);
                    return abort;
                }
            }

            function arg_may_throw(reject, node, value) {
                if (node instanceof AST_DefaultValue) {
                    return reject(node.value)
                        || arg_may_throw(reject, node.name, node.value)
                        || !is_undefined(value) && arg_may_throw(reject, node.name, value);
                }
                if (!value) return !(node instanceof AST_Symbol);
                if (node instanceof AST_Destructured) {
                    if (node.rest && arg_may_throw(reject, node.rest)) return true;
                    if (node instanceof AST_DestructuredArray) {
                        if (value instanceof AST_Array) return !all(node.elements, function(element, index) {
                            return !arg_may_throw(reject, element, value[index]);
                        });
                        if (!value.is_string(compressor)) return true;
                        return !all(node.elements, function(element) {
                            return !arg_may_throw(reject, element);
                        });
                    }
                    if (node instanceof AST_DestructuredObject) {
                        if (value.may_throw_on_access(compressor)) return true;
                        return !all(node.properties, function(prop) {
                            if (prop.key instanceof AST_Node && reject(prop.key)) return false;
                            return !arg_may_throw(reject, prop.value);
                        });
                    }
                }
            }

            function extract_args() {
                if (in_iife_single === false) return;
                var iife = compressor.parent(), fn = compressor.self();
                if (in_iife_single === undefined) {
                    if (!(fn instanceof AST_LambdaExpression)
                        || is_generator(fn)
                        || fn.uses_arguments
                        || fn.pinned()
                        || !(iife instanceof AST_Call)
                        || iife.expression !== fn
                        || !all(iife.args, function(arg) {
                            return !(arg instanceof AST_Spread);
                        })) {
                        in_iife_single = false;
                        return;
                    }
                    if (!is_iife_single(iife)) return;
                    in_iife_single = true;
                }
                var fn_strict = fn.in_strict_mode(compressor)
                    && !fn.parent_scope.resolve(true).in_strict_mode(compressor);
                var has_await;
                if (is_async(fn)) {
                    has_await = function(node) {
                        return node instanceof AST_Symbol && node.name == "await";
                    };
                    iife_in_try = true;
                } else {
                    has_await = function(node) {
                        return node instanceof AST_Await && !tw.find_parent(AST_Scope);
                    };
                    if (iife_in_try === undefined) iife_in_try = find_try(compressor, 1, iife, null, true, true);
                }
                var arg_scope = null;
                var tw = new TreeWalker(function(node, descend) {
                    if (!arg) return true;
                    if (has_await(node) || node instanceof AST_Yield) {
                        arg = null;
                        return true;
                    }
                    if (node instanceof AST_ObjectIdentity) {
                        if (fn_strict || !arg_scope) arg = null;
                        return true;
                    }
                    if (node instanceof AST_SymbolRef) {
                        var def;
                        if (node.in_arg && !is_safe_lexical(node.definition())
                            || (def = fn.variables.get(node.name)) && def !== node.definition()) {
                            arg = null;
                        }
                        return true;
                    }
                    if (node instanceof AST_Scope && !is_arrow(node)) {
                        var save_scope = arg_scope;
                        arg_scope = node;
                        descend();
                        arg_scope = save_scope;
                        return true;
                    }
                });
                args = iife.args.slice();
                var len = args.length;
                var names = new Dictionary();
                for (var i = fn.argnames.length; --i >= 0;) {
                    var sym = fn.argnames[i];
                    var arg = args[i];
                    var value = null;
                    if (sym instanceof AST_DefaultValue) {
                        value = sym.value;
                        sym = sym.name;
                        args[len + i] = value;
                    }
                    if (sym instanceof AST_Destructured) {
                        if (iife_in_try && arg_may_throw(function(node) {
                            return node.has_side_effects(compressor);
                        }, sym, arg)) {
                            candidates.length = 0;
                            break;
                        }
                        args[len + i] = fn.argnames[i];
                        continue;
                    }
                    if (names.has(sym.name)) continue;
                    names.set(sym.name, true);
                    if (value) arg = is_undefined(arg) ? value : null;
                    if (!arg && !value) {
                        arg = make_node(AST_Undefined, sym).transform(compressor);
                    } else if (arg instanceof AST_Lambda && arg.pinned()) {
                        arg = null;
                    } else if (arg) {
                        arg.walk(tw);
                    }
                    if (!arg) continue;
                    var candidate = make_node(AST_VarDef, sym, {
                        name: sym,
                        value: arg,
                    });
                    candidate.name_index = i;
                    candidate.arg_index = value ? len + i : i;
                    candidates.unshift([ candidate ]);
                }
                if (fn.rest) args.push(fn.rest);
            }

            function extract_candidates(expr, unused) {
                hit_stack.push(expr);
                if (expr instanceof AST_Array) {
                    expr.elements.forEach(function(node) {
                        extract_candidates(node, unused);
                    });
                } else if (expr instanceof AST_Assign) {
                    var lhs = expr.left;
                    if (!(lhs instanceof AST_Destructured)) candidates.push(hit_stack.slice());
                    extract_candidates(lhs);
                    extract_candidates(expr.right);
                    if (lhs instanceof AST_SymbolRef && expr.operator == "=") {
                        assignments.set(lhs.name, (assignments.get(lhs.name) || 0) + 1);
                    }
                } else if (expr instanceof AST_Await) {
                    extract_candidates(expr.expression, unused);
                } else if (expr instanceof AST_Binary) {
                    var lazy = lazy_op[expr.operator];
                    if (unused
                        && lazy
                        && expr.operator != "??"
                        && expr.right instanceof AST_Assign
                        && expr.right.operator == "="
                        && !(expr.right.left instanceof AST_Destructured)) {
                        candidates.push(hit_stack.slice());
                    }
                    extract_candidates(expr.left, !lazy && unused);
                    extract_candidates(expr.right, unused);
                } else if (expr instanceof AST_Call) {
                    extract_candidates(expr.expression);
                    expr.args.forEach(extract_candidates);
                } else if (expr instanceof AST_Case) {
                    extract_candidates(expr.expression);
                } else if (expr instanceof AST_Conditional) {
                    extract_candidates(expr.condition);
                    extract_candidates(expr.consequent, unused);
                    extract_candidates(expr.alternative, unused);
                } else if (expr instanceof AST_Definitions) {
                    expr.definitions.forEach(extract_candidates);
                } else if (expr instanceof AST_Dot) {
                    extract_candidates(expr.expression);
                } else if (expr instanceof AST_DWLoop) {
                    extract_candidates(expr.condition);
                    if (!(expr.body instanceof AST_Block)) {
                        extract_candidates(expr.body);
                    }
                } else if (expr instanceof AST_Exit) {
                    if (expr.value) extract_candidates(expr.value);
                } else if (expr instanceof AST_For) {
                    if (expr.init) extract_candidates(expr.init, true);
                    if (expr.condition) extract_candidates(expr.condition);
                    if (expr.step) extract_candidates(expr.step, true);
                    if (!(expr.body instanceof AST_Block)) {
                        extract_candidates(expr.body);
                    }
                } else if (expr instanceof AST_ForEnumeration) {
                    extract_candidates(expr.object);
                    if (!(expr.body instanceof AST_Block)) {
                        extract_candidates(expr.body);
                    }
                } else if (expr instanceof AST_If) {
                    extract_candidates(expr.condition);
                    if (!(expr.body instanceof AST_Block)) {
                        extract_candidates(expr.body);
                    }
                    if (expr.alternative && !(expr.alternative instanceof AST_Block)) {
                        extract_candidates(expr.alternative);
                    }
                } else if (expr instanceof AST_Object) {
                    expr.properties.forEach(function(prop) {
                        hit_stack.push(prop);
                        if (prop.key instanceof AST_Node) extract_candidates(prop.key);
                        if (prop instanceof AST_ObjectKeyVal) extract_candidates(prop.value, unused);
                        hit_stack.pop();
                    });
                } else if (expr instanceof AST_Sequence) {
                    var end = expr.expressions.length - (unused ? 0 : 1);
                    expr.expressions.forEach(function(node, index) {
                        extract_candidates(node, index < end);
                    });
                } else if (expr instanceof AST_SimpleStatement) {
                    extract_candidates(expr.body, true);
                } else if (expr instanceof AST_Spread) {
                    extract_candidates(expr.expression);
                } else if (expr instanceof AST_Sub) {
                    extract_candidates(expr.expression);
                    extract_candidates(expr.property);
                } else if (expr instanceof AST_Switch) {
                    extract_candidates(expr.expression);
                    expr.body.forEach(extract_candidates);
                } else if (expr instanceof AST_Unary) {
                    if (UNARY_POSTFIX[expr.operator]) {
                        candidates.push(hit_stack.slice());
                    } else {
                        extract_candidates(expr.expression);
                    }
                } else if (expr instanceof AST_VarDef) {
                    if (expr.name instanceof AST_SymbolVar) {
                        if (expr.value) {
                            var def = expr.name.definition();
                            if (def.references.length > def.replaced) {
                                candidates.push(hit_stack.slice());
                            }
                        } else {
                            declare_only.set(expr.name.name, (declare_only.get(expr.name.name) || 0) + 1);
                        }
                    }
                    if (expr.value) extract_candidates(expr.value);
                } else if (expr instanceof AST_Yield) {
                    if (expr.expression) extract_candidates(expr.expression);
                }
                hit_stack.pop();
            }

            function find_stop(node, level) {
                var parent = scanner.parent(level);
                if (parent instanceof AST_Array) return node;
                if (parent instanceof AST_Assign) return node;
                if (parent instanceof AST_Await) return node;
                if (parent instanceof AST_Binary) return node;
                if (parent instanceof AST_Call) return node;
                if (parent instanceof AST_Case) return node;
                if (parent instanceof AST_Conditional) return node;
                if (parent instanceof AST_Definitions) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_Exit) return node;
                if (parent instanceof AST_If) return node;
                if (parent instanceof AST_IterationStatement) return node;
                if (parent instanceof AST_ObjectProperty) return node;
                if (parent instanceof AST_PropAccess) return node;
                if (parent instanceof AST_Sequence) {
                    return (parent.tail_node() === node ? find_stop : find_stop_unused)(parent, level + 1);
                }
                if (parent instanceof AST_SimpleStatement) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_Spread) return node;
                if (parent instanceof AST_Switch) return node;
                if (parent instanceof AST_Unary) return node;
                if (parent instanceof AST_VarDef) return node;
                if (parent instanceof AST_Yield) return node;
                return null;
            }

            function find_stop_logical(parent, op, level) {
                var node;
                do {
                    node = parent;
                    parent = scanner.parent(++level);
                } while (parent instanceof AST_Assign && parent.operator.slice(0, -1) == op
                    || parent instanceof AST_Binary && parent.operator == op);
                return node;
            }

            function find_stop_expr(expr, cont, node, parent, level) {
                var replace = can_replace;
                can_replace = false;
                var after = stop_after;
                var if_hit = stop_if_hit;
                var stack = scanner.stack;
                scanner.stack = [ parent ];
                expr.transform(scanner);
                scanner.stack = stack;
                stop_if_hit = if_hit;
                stop_after = after;
                can_replace = replace;
                if (abort) {
                    abort = false;
                    return node;
                }
                return cont(parent, level + 1);
            }

            function find_stop_value(node, level) {
                var parent = scanner.parent(level);
                if (parent instanceof AST_Array) return find_stop_value(parent, level + 1);
                if (parent instanceof AST_Assign) {
                    if (may_throw(parent)) return node;
                    if (parent.left.match_symbol(function(ref) {
                        return ref instanceof AST_SymbolRef && (lhs.name == ref.name || value_def.name == ref.name);
                    })) return node;
                    var op;
                    if (parent.left === node || !lazy_op[op = parent.operator.slice(0, -1)]) {
                        return find_stop_value(parent, level + 1);
                    }
                    return find_stop_logical(parent, op, level);
                }
                if (parent instanceof AST_Await) return find_stop_value(parent, level + 1);
                if (parent instanceof AST_Binary) {
                    var op;
                    if (parent.left === node || !lazy_op[op = parent.operator]) {
                        return find_stop_value(parent, level + 1);
                    }
                    return find_stop_logical(parent, op, level);
                }
                if (parent instanceof AST_Call) return parent;
                if (parent instanceof AST_Case) {
                    if (parent.expression !== node) return node;
                    return find_stop_value(parent, level + 1);
                }
                if (parent instanceof AST_Conditional) {
                    if (parent.condition !== node) return node;
                    return find_stop_value(parent, level + 1);
                }
                if (parent instanceof AST_Definitions) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_Do) return node;
                if (parent instanceof AST_Exit) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_For) {
                    if (parent.init !== node && parent.condition !== node) return node;
                    return find_stop_value(parent, level + 1);
                }
                if (parent instanceof AST_ForEnumeration) {
                    if (parent.init !== node) return node;
                    return find_stop_value(parent, level + 1);
                }
                if (parent instanceof AST_If) {
                    if (parent.condition !== node) return node;
                    return find_stop_value(parent, level + 1);
                }
                if (parent instanceof AST_ObjectProperty) {
                    var obj = scanner.parent(level + 1);
                    return all(obj.properties, function(prop) {
                        return prop instanceof AST_ObjectKeyVal;
                    }) ? find_stop_value(obj, level + 2) : obj;
                }
                if (parent instanceof AST_PropAccess) {
                    var exp = parent.expression;
                    return exp === node ? find_stop_value(parent, level + 1) : node;
                }
                if (parent instanceof AST_Sequence) {
                    return (parent.tail_node() === node ? find_stop_value : find_stop_unused)(parent, level + 1);
                }
                if (parent instanceof AST_SimpleStatement) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_Spread) return find_stop_value(parent, level + 1);
                if (parent instanceof AST_Switch) {
                    if (parent.expression !== node) return node;
                    return find_stop_value(parent, level + 1);
                }
                if (parent instanceof AST_Unary) {
                    if (parent.operator == "delete") return node;
                    return find_stop_value(parent, level + 1);
                }
                if (parent instanceof AST_VarDef) return parent.name.match_symbol(function(sym) {
                    return sym instanceof AST_SymbolDeclaration && (lhs.name == sym.name || value_def.name == sym.name);
                }) ? node : find_stop_value(parent, level + 1);
                if (parent instanceof AST_While) {
                    if (parent.condition !== node) return node;
                    return find_stop_value(parent, level + 1);
                }
                if (parent instanceof AST_Yield) return find_stop_value(parent, level + 1);
                return null;
            }

            function find_stop_unused(node, level) {
                var parent = scanner.parent(level);
                if (is_last_node(node, parent)) return node;
                if (in_conditional(node, parent)) return node;
                if (parent instanceof AST_Array) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_Assign) return check_assignment(parent.left);
                if (parent instanceof AST_Await) return node;
                if (parent instanceof AST_Binary) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_Call) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_Case) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_Conditional) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_Definitions) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_Exit) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_If) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_IterationStatement) return node;
                if (parent instanceof AST_ObjectProperty) {
                    var obj = scanner.parent(level + 1);
                    return all(obj.properties, function(prop) {
                        return prop instanceof AST_ObjectKeyVal;
                    }) ? find_stop_unused(obj, level + 2) : obj;
                }
                if (parent instanceof AST_PropAccess) {
                    var exp = parent.expression;
                    if (exp === node) return find_stop_unused(parent, level + 1);
                    return find_stop_expr(exp, find_stop_unused, node, parent, level);
                }
                if (parent instanceof AST_Sequence) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_SimpleStatement) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_Spread) return node;
                if (parent instanceof AST_Switch) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_Unary) return find_stop_unused(parent, level + 1);
                if (parent instanceof AST_VarDef) return check_assignment(parent.name);
                if (parent instanceof AST_Yield) return node;
                return null;

                function check_assignment(lhs) {
                    if (may_throw(parent)) return node;
                    if (lhs !== node && lhs instanceof AST_Destructured) {
                        return find_stop_expr(lhs, find_stop_unused, node, parent, level);
                    }
                    return find_stop_unused(parent, level + 1);
                }
            }

            function mangleable_var(rhs) {
                if (force_single) {
                    force_single = false;
                    return;
                }
                if (remaining < 1) return;
                rhs = rhs.tail_node();
                var value = rhs instanceof AST_Assign && rhs.operator == "=" ? rhs.left : rhs;
                if (!(value instanceof AST_SymbolRef)) return;
                var def = value.definition();
                if (def.undeclared) return;
                if (is_arguments(def)) return;
                if (value !== rhs) {
                    if (is_lhs_read_only(value, compressor)) return;
                    var referenced = def.references.length - def.replaced;
                    if (referenced < 2) return;
                    var expr = candidate.clone();
                    expr[expr instanceof AST_Assign ? "right" : "value"] = value;
                    if (candidate.name_index >= 0) {
                        expr.name_index = candidate.name_index;
                        expr.arg_index = candidate.arg_index;
                    }
                    candidate = expr;
                }
                return value_def = def;
            }

            function remaining_refs(def) {
                return def.references.length - def.replaced - (assignments.get(def.name) || 0);
            }

            function get_lhs(expr) {
                if (expr instanceof AST_Assign) {
                    var lhs = expr.left;
                    if (!(lhs instanceof AST_SymbolRef)) return lhs;
                    var def = lhs.definition();
                    if (scope.uses_arguments && is_funarg(def)) return lhs;
                    if (compressor.exposed(def)) return lhs;
                    remaining = remaining_refs(def);
                    if (def.fixed && lhs.fixed) {
                        var matches = def.references.filter(function(ref) {
                            return ref.fixed === lhs.fixed;
                        }).length - 1;
                        if (matches < remaining) {
                            remaining = matches;
                            assign_pos = 0;
                            verify_ref = true;
                        }
                    }
                    if (expr.operator == "=") mangleable_var(expr.right);
                    return lhs;
                }
                if (expr instanceof AST_Binary) return expr.right.left;
                if (expr instanceof AST_Unary) return expr.expression;
                if (expr instanceof AST_VarDef) {
                    var lhs = expr.name;
                    var def = lhs.definition();
                    if (def.const_redefs) return;
                    if (!member(lhs, def.orig)) return;
                    if (scope.uses_arguments && is_funarg(def)) return;
                    var declared = def.orig.length - def.eliminated - (declare_only.get(def.name) || 0);
                    remaining = remaining_refs(def);
                    if (def.fixed) remaining = Math.min(remaining, def.references.filter(function(ref) {
                        if (!ref.fixed) return true;
                        if (!ref.fixed.assigns) return true;
                        var assign = ref.fixed.assigns[0];
                        return assign === lhs || get_rvalue(assign) === expr.value;
                    }).length);
                    if (declared > 1 && !(lhs instanceof AST_SymbolFunarg)) {
                        mangleable_var(expr.value);
                        return make_node(AST_SymbolRef, lhs);
                    }
                    if (mangleable_var(expr.value) || remaining == 1 && !compressor.exposed(def)) {
                        return make_node(AST_SymbolRef, lhs);
                    }
                    return;
                }
            }

            function get_rvalue(expr) {
                if (expr instanceof AST_Assign) return expr.right;
                if (expr instanceof AST_Binary) {
                    var node = expr.clone();
                    node.right = expr.right.right;
                    return node;
                }
                if (expr instanceof AST_VarDef) return expr.value;
            }

            function invariant(expr) {
                if (expr instanceof AST_Array) return false;
                if (expr instanceof AST_Binary && lazy_op[expr.operator]) {
                    return invariant(expr.left) && invariant(expr.right);
                }
                if (expr instanceof AST_Call) return false;
                if (expr instanceof AST_Conditional) {
                    return invariant(expr.consequent) && invariant(expr.alternative);
                }
                if (expr instanceof AST_Object) return false;
                return !expr.has_side_effects(compressor);
            }

            function foldable(expr) {
                if (expr instanceof AST_Assign && expr.right.single_use) return;
                var lhs_ids = Object.create(null);
                var marker = new TreeWalker(function(node) {
                    if (node instanceof AST_SymbolRef) lhs_ids[node.definition().id] = true;
                });
                while (expr instanceof AST_Assign && expr.operator == "=") {
                    expr.left.walk(marker);
                    expr = expr.right;
                }
                if (expr instanceof AST_ObjectIdentity) return rhs_exact_match;
                if (expr instanceof AST_SymbolRef) {
                    var value = expr.evaluate(compressor);
                    if (value === expr) return rhs_exact_match;
                    return rhs_fuzzy_match(value, rhs_exact_match);
                }
                if (expr.is_truthy()) return rhs_fuzzy_match(true, return_false);
                if (expr.is_constant()) {
                    var ev = expr.evaluate(compressor);
                    if (!(ev instanceof AST_Node)) return rhs_fuzzy_match(ev, rhs_exact_match);
                }
                if (!(lhs instanceof AST_SymbolRef)) return false;
                if (!invariant(expr)) return false;
                var circular;
                expr.walk(new TreeWalker(function(node) {
                    if (circular) return true;
                    if (node instanceof AST_SymbolRef && lhs_ids[node.definition().id]) circular = true;
                }));
                return !circular && rhs_exact_match;

                function rhs_exact_match(node) {
                    return expr.equals(node);
                }
            }

            function rhs_fuzzy_match(value, fallback) {
                return function(node, tw) {
                    if (tw.in_boolean_context()) {
                        if (value && node.is_truthy() && !node.has_side_effects(compressor)) {
                            return true;
                        }
                        if (node.is_constant()) {
                            var ev = node.evaluate(compressor);
                            if (!(ev instanceof AST_Node)) return !ev == !value;
                        }
                    }
                    return fallback(node);
                };
            }

            function clear_write_only(assign) {
                while (assign.write_only) {
                    assign.write_only = false;
                    if (!(assign instanceof AST_Assign)) break;
                    assign = assign.right;
                }
            }

            function update_symbols(value, node) {
                var scope = node.scope || find_scope(scanner) || block_scope;
                value.walk(new TreeWalker(function(node) {
                    if (node instanceof AST_BlockScope) return true;
                    if (node instanceof AST_Symbol) node.scope = scope;
                }));
            }

            function may_be_global(node) {
                if (node instanceof AST_SymbolRef) {
                    node = node.fixed_value();
                    if (!node) return true;
                }
                if (node instanceof AST_Assign) return node.operator == "=" && may_be_global(node.right);
                return node instanceof AST_PropAccess || node instanceof AST_ObjectIdentity;
            }

            function get_lvalues(expr) {
                var lvalues = new Dictionary();
                if (expr instanceof AST_VarDef) {
                    if (!expr.name.definition().fixed) well_defined = false;
                    lvalues.add(expr.name.name, lhs);
                }
                var find_arguments = scope.uses_arguments && !compressor.has_directive("use strict");
                var scan_toplevel = scope instanceof AST_Toplevel;
                var tw = new TreeWalker(function(node) {
                    var value;
                    if (node instanceof AST_SymbolRef) {
                        value = node.fixed_value();
                        if (!value) {
                            value = node;
                            var def = node.definition();
                            var escaped = node.fixed && node.fixed.escaped || def.escaped;
                            if (!def.undeclared
                                && (def.assignments || !escaped || escaped.cross_scope)
                                && (has_escaped(def, node.scope, node, tw.parent()) || !same_scope(def))) {
                                well_defined = false;
                            }
                        }
                    } else if (node instanceof AST_ObjectIdentity) {
                        value = node;
                    }
                    if (value) {
                        lvalues.add(node.name, is_modified(compressor, tw, node, value, 0));
                    } else if (node instanceof AST_Lambda) {
                        for (var level = 0, parent, child = node; parent = tw.parent(level++); child = parent) {
                            if (parent instanceof AST_Assign) {
                                if (parent.left === child) break;
                                if (parent.operator == "=") continue;
                                if (lazy_op[parent.operator.slice(0, -1)]) continue;
                                break;
                            }
                            if (parent instanceof AST_Binary) {
                                if (lazy_op[parent.operator]) continue;
                                break;
                            }
                            if (parent instanceof AST_Call) return;
                            if (parent instanceof AST_Scope) return;
                            if (parent instanceof AST_Sequence) {
                                if (parent.tail_node() === child) continue;
                                break;
                            }
                            if (parent instanceof AST_Template) {
                                if (parent.tag) return;
                                break;
                            }
                        }
                        node.enclosed.forEach(function(def) {
                            if (def.scope !== node) enclosed.set(def.name, true);
                        });
                        return true;
                    } else if (find_arguments && node instanceof AST_Sub) {
                        scope.each_argname(function(argname) {
                            if (!compressor.option("reduce_vars") || argname.definition().assignments) {
                                if (!argname.definition().fixed) well_defined = false;
                                lvalues.add(argname.name, true);
                            }
                        });
                        find_arguments = false;
                    }
                    if (!scan_toplevel) return;
                    if (node.TYPE == "Call") {
                        if (modify_toplevel) return;
                        var exp = node.expression;
                        if (exp instanceof AST_PropAccess) return;
                        if (exp instanceof AST_LambdaExpression && !exp.contains_this()) return;
                        modify_toplevel = true;
                    } else if (node instanceof AST_PropAccess && may_be_global(node.expression)) {
                        if (node === lhs && !(expr instanceof AST_Unary)) {
                            modify_toplevel = true;
                        } else {
                            read_toplevel = true;
                        }
                    }
                });
                expr.walk(tw);
                return lvalues;
            }

            function remove_candidate(expr) {
                var value = rvalue === rhs_value ? null : make_sequence(rhs_value, rhs_value.expressions.slice(0, -1));
                var index = expr.name_index;
                if (index >= 0) {
                    var args, argname = scope.argnames[index];
                    if (argname instanceof AST_DefaultValue) {
                        scope.argnames[index] = argname = argname.clone();
                        argname.value = value || make_node(AST_Number, argname, { value: 0 });
                    } else if ((args = compressor.parent().args)[index]) {
                        scope.argnames[index] = argname.clone();
                        args[index] = value || make_node(AST_Number, args[index], { value: 0 });
                    }
                    return;
                }
                var end = hit_stack.length - 1;
                var last = hit_stack[end];
                if (last instanceof AST_VarDef || hit_stack[end - 1].body === last) end--;
                var tt = new TreeTransformer(function(node, descend, in_list) {
                    if (hit) return node;
                    if (node !== hit_stack[hit_index]) return node;
                    hit_index++;
                    if (hit_index <= end) return handle_custom_scan_order(node, tt);
                    hit = true;
                    if (node instanceof AST_Definitions) {
                        declare_only.set(last.name.name, (declare_only.get(last.name.name) || 0) + 1);
                        if (value_def) value_def.replaced++;
                        var defns = node.definitions;
                        var index = defns.indexOf(last);
                        var defn = last.clone();
                        defn.value = null;
                        if (!value) {
                            node.definitions[index] = defn;
                            return node;
                        }
                        var body = [ make_node(AST_SimpleStatement, value, { body: value }) ];
                        if (index > 0) {
                            var head = node.clone();
                            head.definitions = defns.slice(0, index);
                            body.unshift(head);
                            node = node.clone();
                            node.definitions = defns.slice(index);
                        }
                        body.push(node);
                        node.definitions[0] = defn;
                        return in_list ? List.splice(body) : make_node(AST_BlockStatement, node, { body: body });
                    }
                    if (!value) return in_list ? List.skip : null;
                    return is_statement(node) ? make_node(AST_SimpleStatement, value, { body: value }) : value;
                }, function(node, in_list) {
                    if (node instanceof AST_For) return patch_for_init(node, in_list);
                    return patch_sequence(node, tt);
                });
                abort = false;
                hit = false;
                hit_index = 0;
                if (!(statements[stat_index] = statements[stat_index].transform(tt))) statements.splice(stat_index, 1);
            }

            function patch_sequence(node, tt) {
                if (node instanceof AST_Sequence) switch (node.expressions.length) {
                  case 0: return null;
                  case 1: return maintain_this_binding(tt.parent(), node, node.expressions[0]);
                }
            }

            function is_lhs_local(lhs) {
                var sym = root_expr(lhs);
                if (!(sym instanceof AST_SymbolRef)) return false;
                if (sym.definition().scope.resolve() !== scope) return false;
                if (!in_loop) return true;
                if (compound) return false;
                if (candidate instanceof AST_Unary) return false;
                var lvalue = lvalues.get(sym.name);
                return !lvalue || lvalue[0] === lhs;
            }

            function value_has_side_effects() {
                if (candidate instanceof AST_Unary) return false;
                return rvalue.has_side_effects(compressor);
            }

            function replace_all_symbols(expr) {
                if (expr instanceof AST_Unary) return false;
                if (side_effects) return false;
                if (value_def) return true;
                if (!(lhs instanceof AST_SymbolRef)) return false;
                var referenced;
                if (expr instanceof AST_VarDef) {
                    referenced = 1;
                } else if (expr.operator == "=") {
                    referenced = 2;
                } else {
                    return false;
                }
                var def = lhs.definition();
                if (def.references.length - def.replaced == referenced) return true;
                if (!def.fixed) return false;
                if (!lhs.fixed) return false;
                var assigns = lhs.fixed.assigns;
                var matched = 0;
                if (!all(def.references, function(ref, index) {
                    var fixed = ref.fixed;
                    if (!fixed) return false;
                    if (fixed.to_binary || fixed.to_prefix) return false;
                    if (fixed === lhs.fixed) {
                        matched++;
                        return true;
                    }
                    return assigns && fixed.assigns && assigns[0] !== fixed.assigns[0];
                })) return false;
                if (matched != referenced) return false;
                verify_ref = true;
                return true;
            }

            function symbol_in_lvalues(sym, parent) {
                var lvalue = lvalues.get(sym.name);
                if (!lvalue || all(lvalue, function(lhs) {
                    return !lhs;
                })) return;
                if (lvalue[0] !== lhs) return true;
                scan_rhs = false;
            }

            function may_modify(sym) {
                var def = sym.definition();
                if (def.orig.length == 1 && def.orig[0] instanceof AST_SymbolDefun) return false;
                if (def.scope.resolve() !== scope) return true;
                if (modify_toplevel && compressor.exposed(def)) return true;
                return !all(def.references, function(ref) {
                    return ref.scope.resolve(true) === scope;
                });
            }

            function side_effects_external(node, lhs) {
                if (node instanceof AST_Assign) return side_effects_external(node.left, true);
                if (node instanceof AST_Unary) return side_effects_external(node.expression, true);
                if (node instanceof AST_VarDef) return node.value && side_effects_external(node.value);
                if (lhs) {
                    if (node instanceof AST_Dot) return side_effects_external(node.expression, true);
                    if (node instanceof AST_Sub) return side_effects_external(node.expression, true);
                    if (node instanceof AST_SymbolRef) return node.definition().scope.resolve() !== scope;
                }
                return false;
            }
        }

        function eliminate_spurious_blocks(statements) {
            var changed = false, seen_dirs = [];
            for (var i = 0; i < statements.length;) {
                var stat = statements[i];
                if (stat instanceof AST_BlockStatement) {
                    if (all(stat.body, safe_to_trim)) {
                        changed = true;
                        eliminate_spurious_blocks(stat.body);
                        [].splice.apply(statements, [i, 1].concat(stat.body));
                        i += stat.body.length;
                        continue;
                    }
                }
                if (stat instanceof AST_Directive) {
                    if (member(stat.value, seen_dirs)) {
                        changed = true;
                        statements.splice(i, 1);
                        continue;
                    }
                    seen_dirs.push(stat.value);
                }
                if (stat instanceof AST_EmptyStatement) {
                    changed = true;
                    statements.splice(i, 1);
                    continue;
                }
                i++;
            }
            return changed;
        }

        function handle_if_return(statements, compressor) {
            var changed = false;
            var parent = compressor.parent();
            var self = compressor.self();
            var declare_only, jump, merge_jump;
            var in_iife = in_lambda && parent && parent.TYPE == "Call" && parent.expression === self;
            var chain_if_returns = in_lambda && compressor.option("conditionals") && compressor.option("sequences");
            var drop_return_void = !(in_try && in_try.bfinally && in_async_generator(scope));
            var multiple_if_returns = has_multiple_if_returns(statements);
            for (var i = statements.length; --i >= 0;) {
                var stat = statements[i];
                var j = next_index(i);
                var next = statements[j];

                if (in_lambda && declare_only && !next && stat instanceof AST_Return
                    && drop_return_void && !(self instanceof AST_SwitchBranch)) {
                    var body = stat.value;
                    if (!body) {
                        changed = true;
                        statements.splice(i, 1);
                        continue;
                    }
                    var tail = body.tail_node();
                    if (is_undefined(tail)) {
                        changed = true;
                        if (body instanceof AST_UnaryPrefix) {
                            body = body.expression;
                        } else if (tail instanceof AST_UnaryPrefix) {
                            body = body.clone();
                            body.expressions[body.expressions.length - 1] = tail.expression;
                        }
                        statements[i] = make_node(AST_SimpleStatement, stat, { body: body });
                        continue;
                    }
                }

                if (stat instanceof AST_If) {
                    var ab = aborts(stat.body);
                    // if (foo()) { bar(); return; } else baz(); moo(); ---> if (foo()) bar(); else { baz(); moo(); }
                    if (can_merge_flow(ab)) {
                        if (ab.label) remove(ab.label.thedef.references, ab);
                        changed = true;
                        stat = stat.clone();
                        stat.body = make_node(AST_BlockStatement, stat, {
                            body: as_statement_array_with_return(stat.body, ab),
                        });
                        stat.alternative = make_node(AST_BlockStatement, stat, {
                            body: as_statement_array(stat.alternative).concat(extract_functions(merge_jump, jump)),
                        });
                        adjust_refs(ab.value, merge_jump);
                        statements[i] = stat;
                        statements[i] = stat.transform(compressor);
                        continue;
                    }
                    // if (foo()) { bar(); return x; } return y; ---> if (!foo()) return y; bar(); return x;
                    if (ab && !stat.alternative && next instanceof AST_Jump) {
                        var cond = stat.condition;
                        var preference = i + 1 == j && stat.body instanceof AST_BlockStatement;
                        cond = best_of_expression(cond, cond.negate(compressor), preference);
                        if (cond !== stat.condition) {
                            changed = true;
                            stat = stat.clone();
                            stat.condition = cond;
                            var body = stat.body;
                            stat.body = make_node(AST_BlockStatement, next, {
                                body: extract_functions(true, null, j + 1),
                            });
                            statements.splice(i, 1, stat, body);
                            // proceed further only if `TreeWalker.stack` is in a consistent state
                            //    https://github.com/mishoo/UglifyJS/issues/5595
                            //    https://github.com/mishoo/UglifyJS/issues/5597
                            if (!in_lambda || self instanceof AST_Block && self.body === statements) {
                                statements[i] = stat.transform(compressor);
                            }
                            continue;
                        }
                    }
                    var alt = aborts(stat.alternative);
                    // if (foo()) bar(); else { baz(); return; } moo(); ---> if (foo()) { bar(); moo(); } else baz();
                    if (can_merge_flow(alt)) {
                        if (alt.label) remove(alt.label.thedef.references, alt);
                        changed = true;
                        stat = stat.clone();
                        stat.body = make_node(AST_BlockStatement, stat.body, {
                            body: as_statement_array(stat.body).concat(extract_functions(merge_jump, jump)),
                        });
                        stat.alternative = make_node(AST_BlockStatement, stat.alternative, {
                            body: as_statement_array_with_return(stat.alternative, alt),
                        });
                        adjust_refs(alt.value, merge_jump);
                        statements[i] = stat;
                        statements[i] = stat.transform(compressor);
                        continue;
                    }
                    if (compressor.option("typeofs")) {
                        if (ab && !alt) {
                            var stats = make_node(AST_BlockStatement, self, { body: statements.slice(i + 1) });
                            mark_locally_defined(stat.condition, null, stats);
                        }
                        if (!ab && alt) {
                            var stats = make_node(AST_BlockStatement, self, { body: statements.slice(i + 1) });
                            mark_locally_defined(stat.condition, stats);
                        }
                    }
                }

                if (stat instanceof AST_If && stat.body instanceof AST_Return) {
                    var value = stat.body.value;
                    var in_bool = stat.body.in_bool || next instanceof AST_Return && next.in_bool;
                    // if (foo()) return x; return y; ---> return foo() ? x : y;
                    if (!stat.alternative && next instanceof AST_Return
                        && (drop_return_void || !value == !next.value)) {
                        changed = true;
                        stat = stat.clone();
                        stat.alternative = make_node(AST_BlockStatement, next, {
                            body: extract_functions(true, null, j + 1),
                        });
                        statements[i] = stat;
                        statements[i] = stat.transform(compressor);
                        continue;
                    }
                    // if (foo()) return x; [ return ; ] ---> return foo() ? x : undefined;
                    // if (foo()) return bar() ? x : void 0; ---> return foo() && bar() ? x : void 0;
                    // if (foo()) return bar() ? void 0 : x; ---> return !foo() || bar() ? void 0 : x;
                    if (in_lambda && declare_only && !next && !stat.alternative && (in_bool
                        || value && multiple_if_returns
                        || value instanceof AST_Conditional && (is_undefined(value.consequent, compressor)
                            || is_undefined(value.alternative, compressor)))) {
                        changed = true;
                        stat = stat.clone();
                        stat.alternative = make_node(AST_Return, stat, { value: null });
                        statements[i] = stat;
                        statements[i] = stat.transform(compressor);
                        continue;
                    }
                    // if (a) return b; if (c) return d; e; ---> return a ? b : c ? d : void e;
                    //
                    // if sequences is not enabled, this can lead to an endless loop (issue #866).
                    // however, with sequences on this helps producing slightly better output for
                    // the example code.
                    var prev, prev_stat;
                    if (chain_if_returns && !stat.alternative
                        && (!(prev_stat = statements[prev = prev_index(i)]) && in_iife
                            || prev_stat instanceof AST_If && prev_stat.body instanceof AST_Return)
                        && (!next ? !declare_only
                            : next instanceof AST_SimpleStatement && next_index(j) == statements.length)) {
                        changed = true;
                        var exprs = [];
                        stat = stat.clone();
                        exprs.push(stat.condition);
                        stat.condition = make_sequence(stat, exprs);
                        stat.alternative = make_node(AST_BlockStatement, self, {
                            body: extract_functions().concat(make_node(AST_Return, self, { value: null })),
                        });
                        statements[i] = stat.transform(compressor);
                        i = prev + 1;
                        continue;
                    }
                }

                if (stat instanceof AST_Break || stat instanceof AST_Exit) {
                    jump = stat;
                    continue;
                }

                if (declare_only && jump && jump === next) eliminate_returns(stat);
            }
            return changed;

            function has_multiple_if_returns(statements) {
                var n = 0;
                for (var i = statements.length; --i >= 0;) {
                    var stat = statements[i];
                    if (stat instanceof AST_If && stat.body instanceof AST_Return) {
                        if (++n > 1) return true;
                    }
                }
                return false;
            }

            function match_target(target) {
                return last_of(compressor, function(node) {
                    return node === target;
                });
            }

            function match_return(ab, exact) {
                if (!jump) return false;
                if (jump.TYPE != ab.TYPE) return false;
                var value = ab.value;
                if (!value) return false;
                var equals = jump.equals(ab);
                if (!equals && value instanceof AST_Sequence) {
                    value = value.tail_node();
                    if (jump.value && jump.value.equals(value)) equals = 2;
                }
                if (!equals && !exact && jump.value instanceof AST_Sequence) {
                    if (jump.value.tail_node().equals(value)) equals = 3;
                }
                return equals;
            }

            function can_drop_abort(ab) {
                if (ab instanceof AST_Exit) {
                    if (merge_jump = match_return(ab)) return true;
                    if (!in_lambda) return false;
                    if (!(ab instanceof AST_Return)) return false;
                    var value = ab.value;
                    if (value && !is_undefined(value.tail_node())) return false;
                    if (!(self instanceof AST_SwitchBranch)) return true;
                    if (!jump) return false;
                    if (jump instanceof AST_Exit && jump.value) return false;
                    merge_jump = 4;
                    return true;
                }
                if (!(ab instanceof AST_LoopControl)) return false;
                if (self instanceof AST_SwitchBranch) {
                    if (jump instanceof AST_Exit) {
                        if (!in_lambda) return false;
                        if (jump.value) return false;
                        merge_jump = true;
                    } else if (jump) {
                        if (compressor.loopcontrol_target(jump) !== parent) return false;
                        merge_jump = true;
                    } else if (jump === false) {
                        return false;
                    }
                }
                var lct = compressor.loopcontrol_target(ab);
                if (ab instanceof AST_Continue) return match_target(loop_body(lct));
                if (lct instanceof AST_IterationStatement) return false;
                return match_target(lct);
            }

            function can_merge_flow(ab) {
                merge_jump = false;
                if (!can_drop_abort(ab)) return false;
                for (var j = statements.length; --j > i;) {
                    var stat = statements[j];
                    if (stat instanceof AST_DefClass) {
                        if (stat.name.definition().preinit) return false;
                    } else if (stat instanceof AST_Const || stat instanceof AST_Let) {
                        if (!all(stat.definitions, function(defn) {
                            return !defn.name.match_symbol(function(node) {
                                return node instanceof AST_SymbolDeclaration && node.definition().preinit;
                            });
                        })) return false;
                    }
                }
                return true;
            }

            function extract_functions(mode, stop, end) {
                var defuns = [];
                var lexical = false;
                var start = i + 1;
                if (!mode) {
                    end = statements.length;
                    jump = null;
                } else if (stop) {
                    end = statements.lastIndexOf(stop);
                } else {
                    stop = statements[end];
                    if (stop !== jump) jump = false;
                }
                var tail = statements.splice(start, end - start).filter(function(stat) {
                    if (stat instanceof AST_LambdaDefinition) {
                        defuns.push(stat);
                        return false;
                    }
                    if (is_lexical_definition(stat)) lexical = true;
                    return true;
                });
                if (mode === 3) {
                    tail.push(make_node(AST_SimpleStatement, stop.value, {
                        body: make_sequence(stop.value, stop.value.expressions.slice(0, -1)),
                    }));
                    stop.value = stop.value.tail_node();
                }
                [].push.apply(lexical ? tail : statements, defuns);
                return tail;
            }

            function trim_return(value, mode) {
                if (value) switch (mode) {
                  case 4:
                    return value;
                  case 3:
                    if (!(value instanceof AST_Sequence)) break;
                  case 2:
                    return make_sequence(value, value.expressions.slice(0, -1));
                }
            }

            function as_statement_array_with_return(node, ab) {
                var body = as_statement_array(node);
                var block = body, last;
                while ((last = block[block.length - 1]) !== ab) {
                    block = last.body;
                }
                block.pop();
                var value = ab.value;
                if (merge_jump) value = trim_return(value, merge_jump);
                if (value) block.push(make_node(AST_SimpleStatement, value, { body: value }));
                return body;
            }

            function adjust_refs(value, mode) {
                if (!mode) return;
                if (!value) return;
                switch (mode) {
                  case 4:
                    return;
                  case 3:
                  case 2:
                    value = value.tail_node();
                }
                merge_expression(value, jump.value);
            }

            function next_index(i) {
                declare_only = true;
                for (var j = i; ++j < statements.length;) {
                    var stat = statements[j];
                    if (is_declaration(stat)) continue;
                    if (stat instanceof AST_Var) {
                        declare_only = false;
                        continue;
                    }
                    break;
                }
                return j;
            }

            function prev_index(i) {
                for (var j = i; --j >= 0;) {
                    var stat = statements[j];
                    if (stat instanceof AST_Var) continue;
                    if (is_declaration(stat)) continue;
                    break;
                }
                return j;
            }

            function eliminate_returns(stat, keep_throws, in_block) {
                if (stat instanceof AST_Exit) {
                    var mode = !(keep_throws && stat instanceof AST_Throw) && match_return(stat, true);
                    if (mode) {
                        changed = true;
                        var value = trim_return(stat.value, mode);
                        if (value) return make_node(AST_SimpleStatement, value, { body: value });
                        return in_block ? null : make_node(AST_EmptyStatement, stat);
                    }
                } else if (stat instanceof AST_If) {
                    stat.body = eliminate_returns(stat.body, keep_throws);
                    if (stat.alternative) stat.alternative = eliminate_returns(stat.alternative, keep_throws);
                } else if (stat instanceof AST_LabeledStatement) {
                    stat.body = eliminate_returns(stat.body, keep_throws);
                } else if (stat instanceof AST_Try) {
                    if (!stat.bfinally || !jump.value || jump.value.is_constant()) {
                        if (stat.bcatch) eliminate_returns(stat.bcatch, keep_throws);
                        var trimmed = eliminate_returns(stat.body.pop(), true, true);
                        if (trimmed) stat.body.push(trimmed);
                    }
                } else if (stat instanceof AST_Block && !(stat instanceof AST_Scope || stat instanceof AST_Switch)) {
                    var trimmed = eliminate_returns(stat.body.pop(), keep_throws, true);
                    if (trimmed) stat.body.push(trimmed);
                }
                return stat;
            }
        }

        function eliminate_dead_code(statements, compressor) {
            var has_quit;
            var self = compressor.self();
            if (self instanceof AST_Catch) {
                self = compressor.parent();
            } else if (self instanceof AST_LabeledStatement) {
                self = self.body;
            }
            for (var i = 0, n = 0, len = statements.length; i < len; i++) {
                var stat = statements[i];
                if (stat instanceof AST_LoopControl) {
                    var lct = compressor.loopcontrol_target(stat);
                    if (loop_body(lct) !== self
                        || stat instanceof AST_Break && lct instanceof AST_IterationStatement) {
                        statements[n++] = stat;
                    } else if (stat.label) {
                        remove(stat.label.thedef.references, stat);
                    }
                } else {
                    statements[n++] = stat;
                }
                if (aborts(stat)) {
                    has_quit = statements.slice(i + 1);
                    break;
                }
            }
            statements.length = n;
            if (has_quit) has_quit.forEach(function(stat) {
                extract_declarations_from_unreachable_code(compressor, stat, statements);
            });
            return statements.length != len;
        }

        function trim_awaits(statements, compressor) {
            if (!in_lambda || in_try && in_try.bfinally) return;
            var changed = false;
            for (var index = statements.length; --index >= 0;) {
                var stat = statements[index];
                if (!(stat instanceof AST_SimpleStatement)) break;
                var node = stat.body;
                if (!(node instanceof AST_Await)) break;
                var exp = node.expression;
                if (!needs_enqueuing(compressor, exp)) break;
                changed = true;
                exp = exp.drop_side_effect_free(compressor, true);
                if (exp) {
                    stat.body = exp;
                    break;
                }
            }
            statements.length = index + 1;
            return changed;
        }

        function inline_iife(statements, compressor) {
            var changed = false;
            var index = statements.length - 1;
            if (in_lambda && index >= 0) {
                var no_return = in_try && in_try.bfinally && in_async_generator(scope);
                var inlined = statements[index].try_inline(compressor, block_scope, no_return);
                if (inlined) {
                    statements[index--] = inlined;
                    changed = true;
                }
            }
            var loop = in_loop && in_try && in_try.bfinally ? "try" : in_loop;
            for (; index >= 0; index--) {
                var inlined = statements[index].try_inline(compressor, block_scope, true, loop);
                if (!inlined) continue;
                statements[index] = inlined;
                changed = true;
            }
            return changed;
        }

        function sequencesize(statements, compressor) {
            if (statements.length < 2) return;
            var seq = [], n = 0;
            function push_seq() {
                if (!seq.length) return;
                var body = make_sequence(seq[0], seq);
                statements[n++] = make_node(AST_SimpleStatement, body, { body: body });
                seq = [];
            }
            for (var i = 0, len = statements.length; i < len; i++) {
                var stat = statements[i];
                if (stat instanceof AST_SimpleStatement) {
                    if (seq.length >= compressor.sequences_limit) push_seq();
                    merge_sequence(seq, stat.body);
                } else if (is_declaration(stat)) {
                    statements[n++] = stat;
                } else {
                    push_seq();
                    statements[n++] = stat;
                }
            }
            push_seq();
            statements.length = n;
            return n != len;
        }

        function to_simple_statement(block, decls) {
            if (!(block instanceof AST_BlockStatement)) return block;
            var stat = null;
            for (var i = 0; i < block.body.length; i++) {
                var line = block.body[i];
                if (line instanceof AST_Var && declarations_only(line)) {
                    decls.push(line);
                } else if (stat || is_lexical_definition(line)) {
                    return false;
                } else {
                    stat = line;
                }
            }
            return stat;
        }

        function sequencesize_2(statements, compressor) {
            var changed = false, n = 0, prev;
            for (var i = 0; i < statements.length; i++) {
                var stat = statements[i];
                if (prev) {
                    if (stat instanceof AST_Exit) {
                        if (stat.value || !in_async_generator(scope)) {
                            stat.value = cons_seq(stat.value || make_node(AST_Undefined, stat)).optimize(compressor);
                        }
                    } else if (stat instanceof AST_For) {
                        if (!(stat.init instanceof AST_Definitions)) {
                            var abort = false;
                            prev.body.walk(new TreeWalker(function(node) {
                                if (abort || node instanceof AST_Scope) return true;
                                if (node instanceof AST_Binary && node.operator == "in") {
                                    abort = true;
                                    return true;
                                }
                            }));
                            if (!abort) {
                                if (stat.init) stat.init = cons_seq(stat.init);
                                else {
                                    stat.init = prev.body;
                                    n--;
                                    changed = true;
                                }
                            }
                        }
                    } else if (stat instanceof AST_ForIn) {
                        if (!is_lexical_definition(stat.init)) stat.object = cons_seq(stat.object);
                    } else if (stat instanceof AST_If) {
                        stat.condition = cons_seq(stat.condition);
                    } else if (stat instanceof AST_Switch) {
                        stat.expression = cons_seq(stat.expression);
                    } else if (stat instanceof AST_With) {
                        stat.expression = cons_seq(stat.expression);
                    }
                }
                if (compressor.option("conditionals") && stat instanceof AST_If) {
                    var decls = [];
                    var body = to_simple_statement(stat.body, decls);
                    var alt = to_simple_statement(stat.alternative, decls);
                    if (body !== false && alt !== false && decls.length > 0) {
                        var len = decls.length;
                        decls.push(make_node(AST_If, stat, {
                            condition: stat.condition,
                            body: body || make_node(AST_EmptyStatement, stat.body),
                            alternative: alt,
                        }));
                        decls.unshift(n, 1);
                        [].splice.apply(statements, decls);
                        i += len;
                        n += len + 1;
                        prev = null;
                        changed = true;
                        continue;
                    }
                }
                statements[n++] = stat;
                prev = stat instanceof AST_SimpleStatement ? stat : null;
            }
            statements.length = n;
            return changed;

            function cons_seq(right) {
                n--;
                changed = true;
                var left = prev.body;
                return make_sequence(left, [ left, right ]);
            }
        }

        function extract_exprs(body) {
            if (body instanceof AST_Assign) return [ body ];
            if (body instanceof AST_Sequence) return body.expressions.slice();
        }

        function join_assigns(defn, body, keep) {
            var exprs = extract_exprs(body);
            if (!exprs) return;
            keep = keep || 0;
            var trimmed = false;
            for (var i = exprs.length - keep; --i >= 0;) {
                var expr = exprs[i];
                if (!can_trim(expr)) continue;
                var tail;
                if (expr.left instanceof AST_SymbolRef) {
                    tail = exprs.slice(i + 1);
                } else if (expr.left instanceof AST_PropAccess && can_trim(expr.left.expression)) {
                    tail = exprs.slice(i + 1);
                    var flattened = expr.clone();
                    expr = expr.left.expression;
                    flattened.left = flattened.left.clone();
                    flattened.left.expression = expr.left.clone();
                    tail.unshift(flattened);
                } else {
                    continue;
                }
                if (tail.length == 0) continue;
                if (!trim_assigns(expr.left, expr.right, tail)) continue;
                trimmed = true;
                exprs = exprs.slice(0, i).concat(expr, tail);
            }
            if (defn instanceof AST_Definitions) {
                for (var i = defn.definitions.length; --i >= 0;) {
                    var def = defn.definitions[i];
                    if (!def.value) continue;
                    if (trim_assigns(def.name, def.value, exprs)) trimmed = true;
                    if (merge_conditional_assignments(def, exprs, keep)) trimmed = true;
                    break;
                }
                if (defn instanceof AST_Var && join_var_assign(defn.definitions, exprs, keep)) trimmed = true;
            }
            return trimmed && exprs;

            function can_trim(node) {
                return node instanceof AST_Assign && node.operator == "=";
            }
        }

        function merge_assigns(prev, defn) {
            if (!(prev instanceof AST_SimpleStatement)) return;
            if (declarations_only(defn)) return;
            var exprs = extract_exprs(prev.body);
            if (!exprs) return;
            var definitions = [];
            if (!join_var_assign(definitions, exprs.reverse(), 0)) return;
            defn.definitions = definitions.reverse().concat(defn.definitions);
            return exprs.reverse();
        }

        function merge_conditional_assignments(var_def, exprs, keep) {
            if (!compressor.option("conditionals")) return;
            if (var_def.name instanceof AST_Destructured) return;
            var trimmed = false;
            var def = var_def.name.definition();
            while (exprs.length > keep) {
                var cond = to_conditional_assignment(compressor, def, var_def.value, exprs[0]);
                if (!cond) break;
                var_def.value = cond;
                exprs.shift();
                trimmed = true;
            }
            return trimmed;
        }

        function join_var_assign(definitions, exprs, keep) {
            var trimmed = false;
            while (exprs.length > keep) {
                var expr = exprs[0];
                if (!(expr instanceof AST_Assign)) break;
                if (expr.operator != "=") break;
                var lhs = expr.left;
                if (!(lhs instanceof AST_SymbolRef)) break;
                if (is_undeclared_ref(lhs)) break;
                if (lhs.scope.resolve() !== scope) break;
                var def = lhs.definition();
                if (def.scope !== scope) break;
                if (def.orig.length > def.eliminated + 1) break;
                if (def.orig[0].TYPE != "SymbolVar") break;
                var name = make_node(AST_SymbolVar, lhs);
                definitions.push(make_node(AST_VarDef, expr, {
                    name: name,
                    value: expr.right,
                }));
                def.orig.push(name);
                def.replaced++;
                exprs.shift();
                trimmed = true;
            }
            return trimmed;
        }

        function trim_assigns(name, value, exprs) {
            var names = new Dictionary();
            names.set(name.name, true);
            while (value instanceof AST_Assign && value.operator == "=") {
                if (value.left instanceof AST_SymbolRef) names.set(value.left.name, true);
                value = value.right;
            }
            if (!(value instanceof AST_Object)) return;
            var trimmed = false;
            do {
                if (!try_join(exprs[0])) break;
                exprs.shift();
                trimmed = true;
            } while (exprs.length);
            return trimmed;

            function try_join(node) {
                if (!(node instanceof AST_Assign)) return;
                if (node.operator != "=") return;
                if (!(node.left instanceof AST_PropAccess)) return;
                var sym = node.left.expression;
                if (!(sym instanceof AST_SymbolRef)) return;
                if (!names.has(sym.name)) return;
                if (!node.right.is_constant_expression(scope)) return;
                var prop = node.left.property;
                if (prop instanceof AST_Node) {
                    if (try_join(prop)) prop = node.left.property = prop.right.clone();
                    prop = prop.evaluate(compressor);
                }
                if (prop instanceof AST_Node) return;
                prop = "" + prop;
                var diff = prop == "__proto__" || compressor.has_directive("use strict") ? function(node) {
                    var key = node.key;
                    return typeof key == "string" && key != prop && key != "__proto__";
                } : function(node) {
                    var key = node.key;
                    if (node instanceof AST_ObjectGetter || node instanceof AST_ObjectSetter) {
                        return typeof key == "string" && key != prop;
                    }
                    return key !== "__proto__";
                };
                if (!all(value.properties, diff)) return;
                value.properties.push(make_node(AST_ObjectKeyVal, node, {
                    key: prop,
                    value: node.right,
                }));
                return true;
            }
        }

        function join_consecutive_vars(statements) {
            var changed = false, defs;
            for (var i = 0, j = -1; i < statements.length; i++) {
                var stat = statements[i];
                var prev = statements[j];
                if (stat instanceof AST_Definitions) {
                    if (prev && prev.TYPE == stat.TYPE) {
                        prev.definitions = prev.definitions.concat(stat.definitions);
                        changed = true;
                    } else if (defs && defs.TYPE == stat.TYPE && declarations_only(stat)) {
                        defs.definitions = defs.definitions.concat(stat.definitions);
                        changed = true;
                    } else if (stat instanceof AST_Var) {
                        var exprs = merge_assigns(prev, stat);
                        if (exprs) {
                            if (exprs.length) {
                                prev.body = make_sequence(prev, exprs);
                                j++;
                            }
                            changed = true;
                        } else {
                            j++;
                        }
                        statements[j] = defs = stat;
                    } else {
                        statements[++j] = stat;
                    }
                    continue;
                } else if (stat instanceof AST_Exit) {
                    stat.value = join_assigns_expr(stat.value);
                } else if (stat instanceof AST_For) {
                    var exprs = join_assigns(prev, stat.init);
                    if (exprs) {
                        changed = true;
                        stat.init = exprs.length ? make_sequence(stat.init, exprs) : null;
                    } else if (prev instanceof AST_Var && (!stat.init || stat.init.TYPE == prev.TYPE)) {
                        if (stat.init) {
                            prev.definitions = prev.definitions.concat(stat.init.definitions);
                        }
                        stat = stat.clone();
                        defs = stat.init = prev;
                        statements[j] = merge_defns(stat);
                        changed = true;
                        continue;
                    } else if (defs && stat.init && defs.TYPE == stat.init.TYPE && declarations_only(stat.init)) {
                        defs.definitions = defs.definitions.concat(stat.init.definitions);
                        stat.init = null;
                        changed = true;
                    } else if (stat.init instanceof AST_Var) {
                        defs = stat.init;
                        exprs = merge_assigns(prev, stat.init);
                        if (exprs) {
                            changed = true;
                            if (exprs.length == 0) {
                                statements[j] = merge_defns(stat);
                                continue;
                            }
                            prev.body = make_sequence(prev, exprs);
                        }
                    }
                } else if (stat instanceof AST_ForEnumeration) {
                    if (defs && defs.TYPE == stat.init.TYPE) {
                        var defns = defs.definitions.slice();
                        stat.init = stat.init.definitions[0].name.convert_symbol(AST_SymbolRef, function(ref, name) {
                            defns.push(make_node(AST_VarDef, name, {
                                name: name,
                                value: null,
                            }));
                            name.definition().references.push(ref);
                        });
                        defs.definitions = defns;
                        changed = true;
                    }
                    stat.object = join_assigns_expr(stat.object);
                } else if (stat instanceof AST_If) {
                    stat.condition = join_assigns_expr(stat.condition);
                } else if (stat instanceof AST_SimpleStatement) {
                    var exprs = join_assigns(prev, stat.body), next;
                    if (exprs) {
                        changed = true;
                        if (!exprs.length) continue;
                        stat.body = make_sequence(stat.body, exprs);
                    } else if (prev instanceof AST_Definitions
                        && (next = statements[i + 1])
                        && prev.TYPE == next.TYPE
                        && (next = next.definitions[0]).value) {
                        changed = true;
                        next.value = make_sequence(stat, [ stat.body, next.value ]);
                        continue;
                    }
                } else if (stat instanceof AST_Switch) {
                    stat.expression = join_assigns_expr(stat.expression);
                } else if (stat instanceof AST_With) {
                    stat.expression = join_assigns_expr(stat.expression);
                }
                statements[++j] = defs ? merge_defns(stat) : stat;
            }
            statements.length = j + 1;
            return changed;

            function join_assigns_expr(value) {
                var exprs = join_assigns(prev, value, 1);
                if (!exprs) return value;
                changed = true;
                var tail = value.tail_node();
                if (exprs[exprs.length - 1] !== tail) exprs.push(tail.left);
                return make_sequence(value, exprs);
            }

            function merge_defns(stat) {
                return stat.transform(new TreeTransformer(function(node, descend, in_list) {
                    if (node instanceof AST_Definitions) {
                        if (defs === node) return node;
                        if (defs.TYPE != node.TYPE) return node;
                        var parent = this.parent();
                        if (parent instanceof AST_ForEnumeration && parent.init === node) return node;
                        if (!declarations_only(node)) return node;
                        defs.definitions = defs.definitions.concat(node.definitions);
                        changed = true;
                        if (parent instanceof AST_For && parent.init === node) return null;
                        return in_list ? List.skip : make_node(AST_EmptyStatement, node);
                    }
                    if (node instanceof AST_ExportDeclaration) return node;
                    if (node instanceof AST_Scope) return node;
                    if (!is_statement(node)) return node;
                }));
            }
        }
    }

    function extract_declarations_from_unreachable_code(compressor, stat, target) {
        var block;
        var dropped = false;
        stat.walk(new TreeWalker(function(node, descend) {
            if (node instanceof AST_DefClass) {
                node.extends = null;
                node.properties = [];
                push(node);
                return true;
            }
            if (node instanceof AST_Definitions) {
                var defns = [];
                if (node.remove_initializers(compressor, defns)) {
                    AST_Node.warn("Dropping initialization in unreachable code [{start}]", node);
                }
                if (defns.length > 0) {
                    node.definitions = defns;
                    push(node);
                }
                return true;
            }
            if (node instanceof AST_LambdaDefinition) {
                push(node);
                return true;
            }
            if (node instanceof AST_Scope) return true;
            if (node instanceof AST_BlockScope) {
                var save = block;
                block = [];
                descend();
                if (block.required) {
                    target.push(make_node(AST_BlockStatement, stat, { body: block }));
                } else if (block.length) {
                    [].push.apply(target, block);
                }
                block = save;
                return true;
            }
            if (!(node instanceof AST_LoopControl)) dropped = true;
        }));
        if (dropped) AST_Node.warn("Dropping unreachable code [{start}]", stat);

        function push(node) {
            if (block) {
                block.push(node);
                if (!safe_to_trim(node)) block.required = true;
            } else {
                target.push(node);
            }
        }
    }

    function is_undefined(node, compressor) {
        return node == null
            || node.is_undefined
            || node instanceof AST_Undefined
            || node instanceof AST_UnaryPrefix
                && node.operator == "void"
                && !(compressor && node.expression.has_side_effects(compressor));
    }

    // in_strict_mode()
    // return true if scope executes in Strict Mode
    (function(def) {
        def(AST_Class, return_true);
        def(AST_Scope, function(compressor) {
            var body = this.body;
            for (var i = 0; i < body.length; i++) {
                var stat = body[i];
                if (!(stat instanceof AST_Directive)) break;
                if (stat.value == "use strict") return true;
            }
            var parent = this.parent_scope;
            if (!parent) return compressor.option("module");
            return parent.resolve(true).in_strict_mode(compressor);
        });
    })(function(node, func) {
        node.DEFMETHOD("in_strict_mode", func);
    });

    // is_truthy()
    // return true if `!!node === true`
    (function(def) {
        def(AST_Node, return_false);
        def(AST_Array, return_true);
        def(AST_Assign, function() {
            return this.operator == "=" && this.right.is_truthy();
        });
        def(AST_Lambda, return_true);
        def(AST_Object, return_true);
        def(AST_RegExp, return_true);
        def(AST_Sequence, function() {
            return this.tail_node().is_truthy();
        });
        def(AST_SymbolRef, function() {
            var fixed = this.fixed_value();
            if (!fixed) return false;
            this.is_truthy = return_false;
            var result = fixed.is_truthy();
            delete this.is_truthy;
            return result;
        });
    })(function(node, func) {
        node.DEFMETHOD("is_truthy", func);
    });

    // is_negative_zero()
    // return true if the node may represent -0
    (function(def) {
        def(AST_Node, return_true);
        def(AST_Array, return_false);
        function binary(op, left, right) {
            switch (op) {
              case "-":
                return left.is_negative_zero()
                    && (!(right instanceof AST_Constant) || right.value == 0);
              case "&&":
              case "||":
                return left.is_negative_zero() || right.is_negative_zero();
              case "*":
              case "/":
              case "%":
              case "**":
                return true;
              default:
                return false;
            }
        }
        def(AST_Assign, function() {
            var op = this.operator;
            if (op == "=") return this.right.is_negative_zero();
            return binary(op.slice(0, -1), this.left, this.right);
        });
        def(AST_Binary, function() {
            return binary(this.operator, this.left, this.right);
        });
        def(AST_Constant, function() {
            return this.value == 0 && 1 / this.value < 0;
        });
        def(AST_Lambda, return_false);
        def(AST_Object, return_false);
        def(AST_RegExp, return_false);
        def(AST_Sequence, function() {
            return this.tail_node().is_negative_zero();
        });
        def(AST_SymbolRef, function() {
            var fixed = this.fixed_value();
            if (!fixed) return true;
            this.is_negative_zero = return_true;
            var result = fixed.is_negative_zero();
            delete this.is_negative_zero;
            return result;
        });
        def(AST_UnaryPrefix, function() {
            return this.operator == "+" && this.expression.is_negative_zero()
                || this.operator == "-";
        });
    })(function(node, func) {
        node.DEFMETHOD("is_negative_zero", func);
    });

    // may_throw_on_access()
    // returns true if this node may be null, undefined or contain `AST_Accessor`
    (function(def) {
        AST_Node.DEFMETHOD("may_throw_on_access", function(compressor, force) {
            return !compressor.option("pure_getters") || this._dot_throw(compressor, force);
        });
        function is_strict(compressor, force) {
            return force || /strict/.test(compressor.option("pure_getters"));
        }
        def(AST_Node, is_strict);
        def(AST_Array, return_false);
        def(AST_Assign, function(compressor) {
            var op = this.operator;
            var sym = this.left;
            var rhs = this.right;
            if (op != "=") {
                return lazy_op[op.slice(0, -1)] && (sym._dot_throw(compressor) || rhs._dot_throw(compressor));
            }
            if (!rhs._dot_throw(compressor)) return false;
            if (!(sym instanceof AST_SymbolRef)) return true;
            if (rhs instanceof AST_Binary && rhs.operator == "||" && sym.name == rhs.left.name) {
                return rhs.right._dot_throw(compressor);
            }
            return true;
        });
        def(AST_Binary, function(compressor) {
            return lazy_op[this.operator] && (this.left._dot_throw(compressor) || this.right._dot_throw(compressor));
        });
        def(AST_Class, function(compressor, force) {
            return is_strict(compressor, force) && !all(this.properties, function(prop) {
                if (prop.private) return true;
                if (!prop.static) return true;
                return !(prop instanceof AST_ClassGetter || prop instanceof AST_ClassSetter);
            });
        });
        def(AST_Conditional, function(compressor) {
            return this.consequent._dot_throw(compressor) || this.alternative._dot_throw(compressor);
        });
        def(AST_Constant, return_false);
        def(AST_Dot, function(compressor, force) {
            if (!is_strict(compressor, force)) return false;
            var exp = this.expression;
            if (exp instanceof AST_SymbolRef) exp = exp.fixed_value();
            return !(this.property == "prototype" && is_lambda(exp));
        });
        def(AST_Lambda, return_false);
        def(AST_Null, return_true);
        def(AST_Object, function(compressor, force) {
            return is_strict(compressor, force) && !all(this.properties, function(prop) {
                if (prop instanceof AST_ObjectGetter || prop instanceof AST_ObjectSetter) return false;
                return !(prop.key === "__proto__" && prop.value._dot_throw(compressor, force));
            });
        });
        def(AST_ObjectIdentity, function(compressor, force) {
            return is_strict(compressor, force) && !this.scope.resolve().new;
        });
        def(AST_Sequence, function(compressor) {
            return this.tail_node()._dot_throw(compressor);
        });
        def(AST_SymbolRef, function(compressor, force) {
            if (this.is_undefined) return true;
            if (!is_strict(compressor, force)) return false;
            if (is_undeclared_ref(this) && this.is_declared(compressor)) return false;
            if (this.is_immutable()) return false;
            var def = this.definition();
            if (is_arguments(def) && !def.scope.rest && all(def.scope.argnames, function(argname) {
                return argname instanceof AST_SymbolFunarg;
            })) return def.scope.uses_arguments > 2;
            var fixed = this.fixed_value(true);
            if (!fixed) return true;
            this._dot_throw = return_true;
            if (fixed._dot_throw(compressor)) {
                delete this._dot_throw;
                return true;
            }
            this._dot_throw = return_false;
            return false;
        });
        def(AST_UnaryPrefix, function() {
            return this.operator == "void";
        });
        def(AST_UnaryPostfix, return_false);
        def(AST_Undefined, return_true);
    })(function(node, func) {
        node.DEFMETHOD("_dot_throw", func);
    });

    (function(def) {
        def(AST_Node, return_false);
        def(AST_Array, return_true);
        function is_binary_defined(compressor, op, node) {
            switch (op) {
              case "&&":
                return node.left.is_defined(compressor) && node.right.is_defined(compressor);
              case "||":
                return node.left.is_truthy() || node.right.is_defined(compressor);
              case "??":
                return node.left.is_defined(compressor) || node.right.is_defined(compressor);
              default:
                return true;
            }
        }
        def(AST_Assign, function(compressor) {
            var op = this.operator;
            if (op == "=") return this.right.is_defined(compressor);
            return is_binary_defined(compressor, op.slice(0, -1), this);
        });
        def(AST_Binary, function(compressor) {
            return is_binary_defined(compressor, this.operator, this);
        });
        def(AST_Conditional, function(compressor) {
            return this.consequent.is_defined(compressor) && this.alternative.is_defined(compressor);
        });
        def(AST_Constant, return_true);
        def(AST_Hole, return_false);
        def(AST_Lambda, return_true);
        def(AST_Object, return_true);
        def(AST_Sequence, function(compressor) {
            return this.tail_node().is_defined(compressor);
        });
        def(AST_SymbolRef, function(compressor) {
            if (this.is_undefined) return false;
            if (is_undeclared_ref(this) && this.is_declared(compressor)) return true;
            if (this.is_immutable()) return true;
            var fixed = this.fixed_value();
            if (!fixed) return false;
            this.is_defined = return_false;
            var result = fixed.is_defined(compressor);
            delete this.is_defined;
            return result;
        });
        def(AST_UnaryPrefix, function() {
            return this.operator != "void";
        });
        def(AST_UnaryPostfix, return_true);
        def(AST_Undefined, return_false);
    })(function(node, func) {
        node.DEFMETHOD("is_defined", func);
    });

    /* -----[ boolean/negation helpers ]----- */

    // methods to determine whether an expression has a boolean result type
    (function(def) {
        def(AST_Node, return_false);
        def(AST_Assign, function(compressor) {
            return this.operator == "=" && this.right.is_boolean(compressor);
        });
        var binary = makePredicate("in instanceof == != === !== < <= >= >");
        def(AST_Binary, function(compressor) {
            return binary[this.operator] || lazy_op[this.operator]
                && this.left.is_boolean(compressor)
                && this.right.is_boolean(compressor);
        });
        def(AST_Boolean, return_true);
        var fn = makePredicate("every hasOwnProperty isPrototypeOf propertyIsEnumerable some");
        def(AST_Call, function(compressor) {
            if (!compressor.option("unsafe")) return false;
            var exp = this.expression;
            return exp instanceof AST_Dot && (fn[exp.property]
                || exp.property == "test" && exp.expression instanceof AST_RegExp);
        });
        def(AST_Conditional, function(compressor) {
            return this.consequent.is_boolean(compressor) && this.alternative.is_boolean(compressor);
        });
        def(AST_New, return_false);
        def(AST_Sequence, function(compressor) {
            return this.tail_node().is_boolean(compressor);
        });
        def(AST_SymbolRef, function(compressor) {
            var fixed = this.fixed_value();
            if (!fixed) return false;
            this.is_boolean = return_false;
            var result = fixed.is_boolean(compressor);
            delete this.is_boolean;
            return result;
        });
        var unary = makePredicate("! delete");
        def(AST_UnaryPrefix, function() {
            return unary[this.operator];
        });
    })(function(node, func) {
        node.DEFMETHOD("is_boolean", func);
    });

    // methods to determine if an expression has a numeric result type
    (function(def) {
        def(AST_Node, return_false);
        var binary = makePredicate("- * / % ** & | ^ << >> >>>");
        def(AST_Assign, function(compressor) {
            return binary[this.operator.slice(0, -1)]
                || this.operator == "=" && this.right.is_number(compressor);
        });
        def(AST_Binary, function(compressor) {
            if (binary[this.operator]) return true;
            if (this.operator != "+") return false;
            return (this.left.is_boolean(compressor) || this.left.is_number(compressor))
                && (this.right.is_boolean(compressor) || this.right.is_number(compressor));
        });
        var fn = makePredicate([
            "charCodeAt",
            "getDate",
            "getDay",
            "getFullYear",
            "getHours",
            "getMilliseconds",
            "getMinutes",
            "getMonth",
            "getSeconds",
            "getTime",
            "getTimezoneOffset",
            "getUTCDate",
            "getUTCDay",
            "getUTCFullYear",
            "getUTCHours",
            "getUTCMilliseconds",
            "getUTCMinutes",
            "getUTCMonth",
            "getUTCSeconds",
            "getYear",
            "indexOf",
            "lastIndexOf",
            "localeCompare",
            "push",
            "search",
            "setDate",
            "setFullYear",
            "setHours",
            "setMilliseconds",
            "setMinutes",
            "setMonth",
            "setSeconds",
            "setTime",
            "setUTCDate",
            "setUTCFullYear",
            "setUTCHours",
            "setUTCMilliseconds",
            "setUTCMinutes",
            "setUTCMonth",
            "setUTCSeconds",
            "setYear",
        ]);
        def(AST_Call, function(compressor) {
            if (!compressor.option("unsafe")) return false;
            var exp = this.expression;
            return exp instanceof AST_Dot && (fn[exp.property]
                || is_undeclared_ref(exp.expression) && exp.expression.name == "Math");
        });
        def(AST_Conditional, function(compressor) {
            return this.consequent.is_number(compressor) && this.alternative.is_number(compressor);
        });
        def(AST_New, return_false);
        def(AST_Number, return_true);
        def(AST_Sequence, function(compressor) {
            return this.tail_node().is_number(compressor);
        });
        def(AST_SymbolRef, function(compressor, keep_unary) {
            var fixed = this.fixed_value();
            if (!fixed) return false;
            if (keep_unary
                && fixed instanceof AST_UnaryPrefix
                && fixed.operator == "+"
                && fixed.expression.equals(this)) {
                return false;
            }
            this.is_number = return_false;
            var result = fixed.is_number(compressor);
            delete this.is_number;
            return result;
        });
        var unary = makePredicate("+ - ~ ++ --");
        def(AST_Unary, function() {
            return unary[this.operator];
        });
    })(function(node, func) {
        node.DEFMETHOD("is_number", func);
    });

    // methods to determine if an expression has a string result type
    (function(def) {
        def(AST_Node, return_false);
        def(AST_Assign, function(compressor) {
            switch (this.operator) {
              case "+=":
                if (this.left.is_string(compressor)) return true;
              case "=":
                return this.right.is_string(compressor);
            }
        });
        def(AST_Binary, function(compressor) {
            return this.operator == "+" &&
                (this.left.is_string(compressor) || this.right.is_string(compressor));
        });
        var fn = makePredicate([
            "charAt",
            "substr",
            "substring",
            "toExponential",
            "toFixed",
            "toLowerCase",
            "toPrecision",
            "toString",
            "toUpperCase",
            "trim",
        ]);
        def(AST_Call, function(compressor) {
            if (!compressor.option("unsafe")) return false;
            var exp = this.expression;
            return exp instanceof AST_Dot && fn[exp.property];
        });
        def(AST_Conditional, function(compressor) {
            return this.consequent.is_string(compressor) && this.alternative.is_string(compressor);
        });
        def(AST_Sequence, function(compressor) {
            return this.tail_node().is_string(compressor);
        });
        def(AST_String, return_true);
        def(AST_SymbolRef, function(compressor) {
            var fixed = this.fixed_value();
            if (!fixed) return false;
            this.is_string = return_false;
            var result = fixed.is_string(compressor);
            delete this.is_string;
            return result;
        });
        def(AST_Template, function(compressor) {
            return !this.tag || is_raw_tag(compressor, this.tag);
        });
        def(AST_UnaryPrefix, function() {
            return this.operator == "typeof";
        });
    })(function(node, func) {
        node.DEFMETHOD("is_string", func);
    });

    var lazy_op = makePredicate("&& || ??");

    (function(def) {
        function to_node(value, orig) {
            if (value instanceof AST_Node) return value.clone(true);
            if (Array.isArray(value)) return make_node(AST_Array, orig, {
                elements: value.map(function(value) {
                    return to_node(value, orig);
                })
            });
            if (value && typeof value == "object") {
                var props = [];
                for (var key in value) if (HOP(value, key)) {
                    props.push(make_node(AST_ObjectKeyVal, orig, {
                        key: key,
                        value: to_node(value[key], orig),
                    }));
                }
                return make_node(AST_Object, orig, { properties: props });
            }
            return make_node_from_constant(value, orig);
        }

        function warn(node) {
            AST_Node.warn("global_defs {this} redefined [{start}]", node);
        }

        AST_Toplevel.DEFMETHOD("resolve_defines", function(compressor) {
            if (!compressor.option("global_defs")) return this;
            this.figure_out_scope({ ie: compressor.option("ie") });
            return this.transform(new TreeTransformer(function(node) {
                var def = node._find_defs(compressor, "");
                if (!def) return;
                var level = 0, child = node, parent;
                while (parent = this.parent(level++)) {
                    if (!(parent instanceof AST_PropAccess)) break;
                    if (parent.expression !== child) break;
                    child = parent;
                }
                if (is_lhs(child, parent)) {
                    warn(node);
                    return;
                }
                return def;
            }));
        });
        def(AST_Node, noop);
        def(AST_Dot, function(compressor, suffix) {
            return this.expression._find_defs(compressor, "." + this.property + suffix);
        });
        def(AST_SymbolDeclaration, function(compressor) {
            if (!this.definition().global) return;
            if (HOP(compressor.option("global_defs"), this.name)) warn(this);
        });
        def(AST_SymbolRef, function(compressor, suffix) {
            if (!this.definition().global) return;
            var defines = compressor.option("global_defs");
            var name = this.name + suffix;
            if (HOP(defines, name)) return to_node(defines[name], this);
        });
    })(function(node, func) {
        node.DEFMETHOD("_find_defs", func);
    });

    function best_of_expression(ast1, ast2, threshold) {
        var delta = ast2.print_to_string().length - ast1.print_to_string().length;
        return delta < (threshold || 0) ? ast2 : ast1;
    }

    function best_of_statement(ast1, ast2, threshold) {
        return best_of_expression(make_node(AST_SimpleStatement, ast1, {
            body: ast1,
        }), make_node(AST_SimpleStatement, ast2, {
            body: ast2,
        }), threshold).body;
    }

    function best_of(compressor, ast1, ast2, threshold) {
        return (first_in_statement(compressor) ? best_of_statement : best_of_expression)(ast1, ast2, threshold);
    }

    function convert_to_predicate(obj) {
        var map = Object.create(null);
        Object.keys(obj).forEach(function(key) {
            map[key] = makePredicate(obj[key]);
        });
        return map;
    }

    function skip_directives(body) {
        for (var i = 0; i < body.length; i++) {
            var stat = body[i];
            if (!(stat instanceof AST_Directive)) return stat;
        }
    }

    function arrow_first_statement() {
        if (this.value) return make_node(AST_Return, this.value, { value: this.value });
        return skip_directives(this.body);
    }
    AST_Arrow.DEFMETHOD("first_statement", arrow_first_statement);
    AST_AsyncArrow.DEFMETHOD("first_statement", arrow_first_statement);
    AST_Lambda.DEFMETHOD("first_statement", function() {
        return skip_directives(this.body);
    });

    AST_Lambda.DEFMETHOD("length", function() {
        var argnames = this.argnames;
        for (var i = 0; i < argnames.length; i++) {
            if (argnames[i] instanceof AST_DefaultValue) break;
        }
        return i;
    });

    function try_evaluate(compressor, node) {
        var ev = node.evaluate(compressor);
        if (ev === node) return node;
        ev = make_node_from_constant(ev, node).optimize(compressor);
        return best_of(compressor, node, ev, compressor.eval_threshold);
    }

    var object_fns = [
        "constructor",
        "toString",
        "valueOf",
    ];
    var native_fns = convert_to_predicate({
        Array: [
            "indexOf",
            "join",
            "lastIndexOf",
            "slice",
        ].concat(object_fns),
        Boolean: object_fns,
        Function: object_fns,
        Number: [
            "toExponential",
            "toFixed",
            "toPrecision",
        ].concat(object_fns),
        Object: object_fns,
        RegExp: [
            "exec",
            "test",
        ].concat(object_fns),
        String: [
            "charAt",
            "charCodeAt",
            "concat",
            "indexOf",
            "italics",
            "lastIndexOf",
            "match",
            "replace",
            "search",
            "slice",
            "split",
            "substr",
            "substring",
            "toLowerCase",
            "toUpperCase",
            "trim",
        ].concat(object_fns),
    });
    var static_fns = convert_to_predicate({
        Array: [
            "isArray",
        ],
        Math: [
            "abs",
            "acos",
            "asin",
            "atan",
            "ceil",
            "cos",
            "exp",
            "floor",
            "log",
            "round",
            "sin",
            "sqrt",
            "tan",
            "atan2",
            "pow",
            "max",
            "min",
        ],
        Number: [
            "isFinite",
            "isNaN",
        ],
        Object: [
            "create",
            "getOwnPropertyDescriptor",
            "getOwnPropertyNames",
            "getPrototypeOf",
            "isExtensible",
            "isFrozen",
            "isSealed",
            "keys",
        ],
        String: [
            "fromCharCode",
            "raw",
        ],
    });

    function is_static_fn(node) {
        if (!(node instanceof AST_Dot)) return false;
        var expr = node.expression;
        if (!is_undeclared_ref(expr)) return false;
        var static_fn = static_fns[expr.name];
        return static_fn && (static_fn[node.property] || expr.name == "Math" && node.property == "random");
    }

    // Accommodate when compress option evaluate=false
    // as well as the common constant expressions !0 and -1
    (function(def) {
        def(AST_Node, return_false);
        def(AST_Constant, return_true);
        def(AST_RegExp, return_false);
        var unaryPrefix = makePredicate("! ~ - + void");
        def(AST_UnaryPrefix, function() {
            return unaryPrefix[this.operator] && this.expression instanceof AST_Constant;
        });
    })(function(node, func) {
        node.DEFMETHOD("is_constant", func);
    });

    // methods to evaluate a constant expression
    (function(def) {
        // If the node has been successfully reduced to a constant,
        // then its value is returned; otherwise the element itself
        // is returned.
        //
        // They can be distinguished as constant value is never a
        // descendant of AST_Node.
        //
        // When `ignore_side_effects` is `true`, inspect the constant value
        // produced without worrying about any side effects caused by said
        // expression.
        AST_Node.DEFMETHOD("evaluate", function(compressor, ignore_side_effects) {
            if (!compressor.option("evaluate")) return this;
            var cached = [];
            var val = this._eval(compressor, ignore_side_effects, cached, 1);
            cached.forEach(function(node) {
                delete node._eval;
            });
            if (ignore_side_effects) return val;
            if (!val || val instanceof RegExp) return val;
            if (typeof val == "function" || typeof val == "object") return this;
            return val;
        });
        var scan_modified = new TreeWalker(function(node) {
            if (node instanceof AST_Assign) modified(node.left);
            if (node instanceof AST_ForEnumeration) modified(node.init);
            if (node instanceof AST_Unary && UNARY_POSTFIX[node.operator]) modified(node.expression);
        });
        function modified(node) {
            if (node instanceof AST_DestructuredArray) {
                node.elements.forEach(modified);
            } else if (node instanceof AST_DestructuredObject) {
                node.properties.forEach(function(prop) {
                    modified(prop.value);
                });
            } else if (node instanceof AST_PropAccess) {
                modified(node.expression);
            } else if (node instanceof AST_SymbolRef) {
                node.definition().references.forEach(function(ref) {
                    delete ref._eval;
                });
            }
        }
        def(AST_Statement, function() {
            throw new Error(string_template("Cannot evaluate a statement [{start}]", this));
        });
        def(AST_Accessor, return_this);
        def(AST_BigInt, return_this);
        def(AST_Class, return_this);
        def(AST_Node, return_this);
        def(AST_Constant, function() {
            return this.value;
        });
        def(AST_Assign, function(compressor, ignore_side_effects, cached, depth) {
            var lhs = this.left;
            if (!ignore_side_effects) {
                if (!(lhs instanceof AST_SymbolRef)) return this;
                if (!HOP(lhs, "_eval")) {
                    if (!lhs.fixed) return this;
                    var def = lhs.definition();
                    if (!def.fixed) return this;
                    if (def.undeclared) return this;
                    if (def.last_ref !== lhs) return this;
                    if (def.single_use == "m") return this;
                    if (this.right.has_side_effects(compressor)) return this;
                }
            }
            var op = this.operator;
            var node;
            if (!HOP(lhs, "_eval") && lhs instanceof AST_SymbolRef && lhs.fixed && lhs.definition().fixed) {
                node = lhs;
            } else if (op == "=") {
                node = this.right;
            } else {
                node = make_node(AST_Binary, this, {
                    operator: op.slice(0, -1),
                    left: lhs,
                    right: this.right,
                });
            }
            lhs.walk(scan_modified);
            var value = node._eval(compressor, ignore_side_effects, cached, depth);
            if (typeof value == "object") return this;
            modified(lhs);
            return value;
        });
        def(AST_Sequence, function(compressor, ignore_side_effects, cached, depth) {
            if (!ignore_side_effects) return this;
            var exprs = this.expressions;
            for (var i = 0, last = exprs.length - 1; i < last; i++) {
                exprs[i].walk(scan_modified);
            }
            var tail = exprs[last];
            var value = tail._eval(compressor, ignore_side_effects, cached, depth);
            return value === tail ? this : value;
        });
        def(AST_Lambda, function(compressor) {
            if (compressor.option("unsafe")) {
                var fn = function() {};
                fn.node = this;
                fn.toString = function() {
                    return "function(){}";
                };
                return fn;
            }
            return this;
        });
        def(AST_Array, function(compressor, ignore_side_effects, cached, depth) {
            if (compressor.option("unsafe")) {
                var elements = [];
                for (var i = 0; i < this.elements.length; i++) {
                    var element = this.elements[i];
                    if (element instanceof AST_Hole) return this;
                    var value = element._eval(compressor, ignore_side_effects, cached, depth);
                    if (element === value) return this;
                    elements.push(value);
                }
                return elements;
            }
            return this;
        });
        def(AST_Object, function(compressor, ignore_side_effects, cached, depth) {
            if (compressor.option("unsafe")) {
                var val = {};
                for (var i = 0; i < this.properties.length; i++) {
                    var prop = this.properties[i];
                    if (!(prop instanceof AST_ObjectKeyVal)) return this;
                    var key = prop.key;
                    if (key instanceof AST_Node) {
                        key = key._eval(compressor, ignore_side_effects, cached, depth);
                        if (key === prop.key) return this;
                    }
                    switch (key) {
                      case "__proto__":
                      case "toString":
                      case "valueOf":
                        return this;
                    }
                    val[key] = prop.value._eval(compressor, ignore_side_effects, cached, depth);
                    if (val[key] === prop.value) return this;
                }
                return val;
            }
            return this;
        });
        var non_converting_unary = makePredicate("! typeof void");
        def(AST_UnaryPrefix, function(compressor, ignore_side_effects, cached, depth) {
            var e = this.expression;
            var op = this.operator;
            // Function would be evaluated to an array and so typeof would
            // incorrectly return "object". Hence making is a special case.
            if (compressor.option("typeofs")
                && op == "typeof"
                && (e instanceof AST_Lambda
                    || e instanceof AST_SymbolRef
                        && e.fixed_value() instanceof AST_Lambda)) {
                return typeof function(){};
            }
            var def = e instanceof AST_SymbolRef && e.definition();
            if (!non_converting_unary[op] && !(def && def.fixed)) depth++;
            e.walk(scan_modified);
            var v = e._eval(compressor, ignore_side_effects, cached, depth);
            if (v === e) {
                if (ignore_side_effects && op == "void") return;
                return this;
            }
            switch (op) {
              case "!": return !v;
              case "typeof":
                // typeof <RegExp> returns "object" or "function" on different platforms
                // so cannot evaluate reliably
                if (v instanceof RegExp) return this;
                return typeof v;
              case "void": return;
              case "~": return ~v;
              case "-": return -v;
              case "+": return +v;
              case "++":
              case "--":
                if (!def) return this;
                if (!ignore_side_effects) {
                    if (def.undeclared) return this;
                    if (def.last_ref !== e) return this;
                }
                if (HOP(e, "_eval")) v = +(op[0] + 1) + +v;
                modified(e);
                return v;
            }
            return this;
        });
        def(AST_UnaryPostfix, function(compressor, ignore_side_effects, cached, depth) {
            var e = this.expression;
            if (!(e instanceof AST_SymbolRef)) {
                if (!ignore_side_effects) return this;
            } else if (!HOP(e, "_eval")) {
                if (!e.fixed) return this;
                if (!ignore_side_effects) {
                    var def = e.definition();
                    if (!def.fixed) return this;
                    if (def.undeclared) return this;
                    if (def.last_ref !== e) return this;
                }
            }
            if (!(e instanceof AST_SymbolRef && e.definition().fixed)) depth++;
            e.walk(scan_modified);
            var v = e._eval(compressor, ignore_side_effects, cached, depth);
            if (v === e) return this;
            modified(e);
            return +v;
        });
        var non_converting_binary = makePredicate("&& || === !==");
        def(AST_Binary, function(compressor, ignore_side_effects, cached, depth) {
            if (!non_converting_binary[this.operator]) depth++;
            var left = this.left._eval(compressor, ignore_side_effects, cached, depth);
            if (left === this.left) return this;
            if (this.operator == (left ? "||" : "&&")) return left;
            var rhs_ignore_side_effects = ignore_side_effects && !(left && typeof left == "object");
            var right = this.right._eval(compressor, rhs_ignore_side_effects, cached, depth);
            if (right === this.right) return this;
            var result;
            switch (this.operator) {
              case "&&" : result = left &&  right; break;
              case "||" : result = left ||  right; break;
              case "??" :
                result = left == null ? right : left;
                break;
              case "|"  : result = left |   right; break;
              case "&"  : result = left &   right; break;
              case "^"  : result = left ^   right; break;
              case "+"  : result = left +   right; break;
              case "-"  : result = left -   right; break;
              case "*"  : result = left *   right; break;
              case "/"  : result = left /   right; break;
              case "%"  : result = left %   right; break;
              case "<<" : result = left <<  right; break;
              case ">>" : result = left >>  right; break;
              case ">>>": result = left >>> right; break;
              case "==" : result = left ==  right; break;
              case "===": result = left === right; break;
              case "!=" : result = left !=  right; break;
              case "!==": result = left !== right; break;
              case "<"  : result = left <   right; break;
              case "<=" : result = left <=  right; break;
              case ">"  : result = left >   right; break;
              case ">=" : result = left >=  right; break;
              case "**":
                result = Math.pow(left, right);
                break;
              case "in":
                if (right && typeof right == "object" && HOP(right, left)) {
                    result = true;
                    break;
                }
              default:
                return this;
            }
            if (isNaN(result)) return compressor.find_parent(AST_With) ? this : result;
            if (compressor.option("unsafe_math")
                && !ignore_side_effects
                && result
                && typeof result == "number"
                && (this.operator == "+" || this.operator == "-")) {
                var digits = Math.max(0, decimals(left), decimals(right));
                // 53-bit significand ---> 15.95 decimal places
                if (digits < 16) return +result.toFixed(digits);
            }
            return result;

            function decimals(operand) {
                var match = /(\.[0-9]*)?(e[^e]+)?$/.exec(+operand);
                return (match[1] || ".").length - 1 - (match[2] || "").slice(1);
            }
        });
        def(AST_Conditional, function(compressor, ignore_side_effects, cached, depth) {
            var condition = this.condition._eval(compressor, ignore_side_effects, cached, depth);
            if (condition === this.condition) return this;
            var node = condition ? this.consequent : this.alternative;
            var value = node._eval(compressor, ignore_side_effects, cached, depth);
            return value === node ? this : value;
        });
        function verify_escaped(ref, depth) {
            var escaped = ref.definition().escaped;
            switch (escaped.length) {
              case 0:
                return true;
              case 1:
                var found = false;
                escaped[0].walk(new TreeWalker(function(node) {
                    if (found) return true;
                    if (node === ref) return found = true;
                    if (node instanceof AST_Scope) return true;
                }));
                return found;
              default:
                return depth <= escaped.depth;
            }
        }
        def(AST_SymbolRef, function(compressor, ignore_side_effects, cached, depth) {
            var fixed = this.fixed_value();
            if (!fixed) return this;
            var value;
            if (HOP(fixed, "_eval")) {
                value = fixed._eval();
            } else {
                this._eval = return_this;
                value = fixed._eval(compressor, ignore_side_effects, cached, depth);
                delete this._eval;
                if (value === fixed) return this;
                fixed._eval = function() {
                    return value;
                };
                cached.push(fixed);
            }
            return value && typeof value == "object" && !verify_escaped(this, depth) ? this : value;
        });
        var global_objs = {
            Array: Array,
            Math: Math,
            Number: Number,
            Object: Object,
            String: String,
        };
        var static_values = convert_to_predicate({
            Math: [
                "E",
                "LN10",
                "LN2",
                "LOG2E",
                "LOG10E",
                "PI",
                "SQRT1_2",
                "SQRT2",
            ],
            Number: [
                "MAX_VALUE",
                "MIN_VALUE",
                "NaN",
                "NEGATIVE_INFINITY",
                "POSITIVE_INFINITY",
            ],
        });
        var regexp_props = makePredicate("global ignoreCase multiline source");
        def(AST_PropAccess, function(compressor, ignore_side_effects, cached, depth) {
            if (compressor.option("unsafe")) {
                var val;
                var exp = this.expression;
                if (!is_undeclared_ref(exp)) {
                    val = exp._eval(compressor, ignore_side_effects, cached, depth + 1);
                    if (val == null || val === exp) return this;
                }
                var key = this.property;
                if (key instanceof AST_Node) {
                    key = key._eval(compressor, ignore_side_effects, cached, depth);
                    if (key === this.property) return this;
                }
                if (val === undefined) {
                    var static_value = static_values[exp.name];
                    if (!static_value || !static_value[key]) return this;
                    val = global_objs[exp.name];
                } else if (val instanceof RegExp) {
                    if (!regexp_props[key]) return this;
                } else if (typeof val == "object") {
                    if (!HOP(val, key)) return this;
                } else if (typeof val == "function") switch (key) {
                  case "name":
                    return val.node.name ? val.node.name.name : "";
                  case "length":
                    return val.node.length();
                  default:
                    return this;
                }
                return val[key];
            }
            return this;
        });
        function eval_all(nodes, compressor, ignore_side_effects, cached, depth) {
            var values = [];
            for (var i = 0; i < nodes.length; i++) {
                var node = nodes[i];
                var value = node._eval(compressor, ignore_side_effects, cached, depth);
                if (node === value) return;
                values.push(value);
            }
            return values;
        }
        def(AST_Call, function(compressor, ignore_side_effects, cached, depth) {
            var exp = this.expression;
            var fn = exp instanceof AST_SymbolRef ? exp.fixed_value() : exp;
            if (fn instanceof AST_Arrow || fn instanceof AST_Defun || fn instanceof AST_Function) {
                if (fn.evaluating) return this;
                if (fn.name && fn.name.definition().recursive_refs > 0) return this;
                if (this.is_expr_pure(compressor)) return this;
                var args = eval_all(this.args, compressor, ignore_side_effects, cached, depth);
                if (!all(fn.argnames, function(sym, index) {
                    if (sym instanceof AST_DefaultValue) {
                        if (!args) return false;
                        if (args[index] === undefined) {
                            var value = sym.value._eval(compressor, ignore_side_effects, cached, depth);
                            if (value === sym.value) return false;
                            args[index] = value;
                        }
                        sym = sym.name;
                    }
                    return !(sym instanceof AST_Destructured);
                })) return this;
                if (fn.rest instanceof AST_Destructured) return this;
                if (!args && !ignore_side_effects) return this;
                var stat = fn.first_statement();
                if (!(stat instanceof AST_Return)) {
                    if (ignore_side_effects) {
                        fn.walk(scan_modified);
                        var found = false;
                        fn.evaluating = true;
                        walk_body(fn, new TreeWalker(function(node) {
                            if (found) return true;
                            if (node instanceof AST_Return) {
                                if (node.value && node.value._eval(compressor, true, cached, depth) !== undefined) {
                                    found = true;
                                }
                                return true;
                            }
                            if (node instanceof AST_Scope && node !== fn) return true;
                        }));
                        fn.evaluating = false;
                        if (!found) return;
                    }
                    return this;
                }
                var val = stat.value;
                if (!val) return;
                var cached_args = [];
                if (!args || all(fn.argnames, function(sym, i) {
                    return assign(sym, args[i]);
                }) && !(fn.rest && !assign(fn.rest, args.slice(fn.argnames.length))) || ignore_side_effects) {
                    if (ignore_side_effects) fn.argnames.forEach(function(sym) {
                        if (sym instanceof AST_DefaultValue) sym.value.walk(scan_modified);
                    });
                    fn.evaluating = true;
                    val = val._eval(compressor, ignore_side_effects, cached, depth);
                    fn.evaluating = false;
                }
                cached_args.forEach(function(node) {
                    delete node._eval;
                });
                return val === stat.value ? this : val;
            } else if (compressor.option("unsafe") && exp instanceof AST_PropAccess) {
                var key = exp.property;
                if (key instanceof AST_Node) {
                    key = key._eval(compressor, ignore_side_effects, cached, depth);
                    if (key === exp.property) return this;
                }
                var val;
                var e = exp.expression;
                if (is_undeclared_ref(e)) {
                    var static_fn = static_fns[e.name];
                    if (!static_fn || !static_fn[key]) return this;
                    val = global_objs[e.name];
                } else {
                    val = e._eval(compressor, ignore_side_effects, cached, depth + 1);
                    if (val == null || val === e) return this;
                    var native_fn = native_fns[val.constructor.name];
                    if (!native_fn || !native_fn[key]) return this;
                    if (val instanceof RegExp && val.global && !(e instanceof AST_RegExp)) return this;
                }
                var args = eval_all(this.args, compressor, ignore_side_effects, cached, depth);
                if (!args) return this;
                if (key == "replace" && typeof args[1] == "function") return this;
                try {
                    return val[key].apply(val, args);
                } catch (ex) {
                    AST_Node.warn("Error evaluating {this} [{start}]", this);
                } finally {
                    if (val instanceof RegExp) val.lastIndex = 0;
                }
            }
            return this;

            function assign(sym, arg) {
                if (sym instanceof AST_DefaultValue) sym = sym.name;
                var def = sym.definition();
                if (def.orig[def.orig.length - 1] !== sym) return false;
                var value = arg;
                def.references.forEach(function(node) {
                    node._eval = function() {
                        return value;
                    };
                    cached_args.push(node);
                });
                return true;
            }
        });
        def(AST_New, return_this);
        def(AST_Template, function(compressor, ignore_side_effects, cached, depth) {
            if (!compressor.option("templates")) return this;
            if (this.tag) {
                if (!is_raw_tag(compressor, this.tag)) return this;
                decode = function(str) {
                    return str;
                };
            }
            var exprs = eval_all(this.expressions, compressor, ignore_side_effects, cached, depth);
            if (!exprs) return this;
            var malformed = false;
            var ret = decode(this.strings[0]);
            for (var i = 0; i < exprs.length; i++) {
                ret += exprs[i] + decode(this.strings[i + 1]);
            }
            if (!malformed) return ret;
            this._eval = return_this;
            return this;

            function decode(str) {
                str = decode_template(str);
                if (typeof str != "string") malformed = true;
                return str;
            }
        });
    })(function(node, func) {
        node.DEFMETHOD("_eval", func);
    });

    // method to negate an expression
    (function(def) {
        function basic_negation(exp) {
            return make_node(AST_UnaryPrefix, exp, {
                operator: "!",
                expression: exp,
            });
        }
        function best(orig, alt, first_in_statement) {
            var negated = basic_negation(orig);
            if (first_in_statement) return best_of_expression(negated, make_node(AST_SimpleStatement, alt, {
                body: alt,
            })) === negated ? negated : alt;
            return best_of_expression(negated, alt);
        }
        def(AST_Node, function() {
            return basic_negation(this);
        });
        def(AST_Statement, function() {
            throw new Error("Cannot negate a statement");
        });
        def(AST_Binary, function(compressor, first_in_statement) {
            var self = this.clone(), op = this.operator;
            if (compressor.option("unsafe_comps")) {
                switch (op) {
                  case "<=" : self.operator = ">"  ; return self;
                  case "<"  : self.operator = ">=" ; return self;
                  case ">=" : self.operator = "<"  ; return self;
                  case ">"  : self.operator = "<=" ; return self;
                }
            }
            switch (op) {
              case "==" : self.operator = "!="; return self;
              case "!=" : self.operator = "=="; return self;
              case "===": self.operator = "!=="; return self;
              case "!==": self.operator = "==="; return self;
              case "&&":
                self.operator = "||";
                self.left = self.left.negate(compressor, first_in_statement);
                self.right = self.right.negate(compressor);
                return best(this, self, first_in_statement);
              case "||":
                self.operator = "&&";
                self.left = self.left.negate(compressor, first_in_statement);
                self.right = self.right.negate(compressor);
                return best(this, self, first_in_statement);
            }
            return basic_negation(this);
        });
        def(AST_ClassExpression, function() {
            return basic_negation(this);
        });
        def(AST_Conditional, function(compressor, first_in_statement) {
            var self = this.clone();
            self.consequent = self.consequent.negate(compressor);
            self.alternative = self.alternative.negate(compressor);
            return best(this, self, first_in_statement);
        });
        def(AST_LambdaExpression, function() {
            return basic_negation(this);
        });
        def(AST_Sequence, function(compressor) {
            var expressions = this.expressions.slice();
            expressions.push(expressions.pop().negate(compressor));
            return make_sequence(this, expressions);
        });
        def(AST_UnaryPrefix, function() {
            if (this.operator == "!")
                return this.expression;
            return basic_negation(this);
        });
    })(function(node, func) {
        node.DEFMETHOD("negate", function(compressor, first_in_statement) {
            return func.call(this, compressor, first_in_statement);
        });
    });

    var global_pure_fns = makePredicate("Boolean decodeURI decodeURIComponent Date encodeURI encodeURIComponent Error escape EvalError isFinite isNaN Number Object parseFloat parseInt RangeError ReferenceError String SyntaxError TypeError unescape URIError");
    var global_pure_constructors = makePredicate("Map Set WeakMap WeakSet");
    AST_Call.DEFMETHOD("is_expr_pure", function(compressor) {
        if (compressor.option("unsafe")) {
            var expr = this.expression;
            if (is_undeclared_ref(expr)) {
                if (global_pure_fns[expr.name]) return true;
                if (this instanceof AST_New && global_pure_constructors[expr.name]) return true;
            }
            if (is_static_fn(expr)) return true;
        }
        return compressor.option("annotations") && this.pure || !compressor.pure_funcs(this);
    });
    AST_Template.DEFMETHOD("is_expr_pure", function(compressor) {
        var tag = this.tag;
        if (!tag) return true;
        if (compressor.option("unsafe")) {
            if (is_undeclared_ref(tag) && global_pure_fns[tag.name]) return true;
            if (tag instanceof AST_Dot && is_undeclared_ref(tag.expression)) {
                var static_fn = static_fns[tag.expression.name];
                return static_fn && (static_fn[tag.property]
                    || tag.expression.name == "Math" && tag.property == "random");
            }
        }
        return !compressor.pure_funcs(this);
    });
    AST_Node.DEFMETHOD("is_call_pure", return_false);
    AST_Call.DEFMETHOD("is_call_pure", function(compressor) {
        if (!compressor.option("unsafe")) return false;
        var dot = this.expression;
        if (!(dot instanceof AST_Dot)) return false;
        var exp = dot.expression;
        var map;
        var prop = dot.property;
        if (exp instanceof AST_Array) {
            map = native_fns.Array;
        } else if (exp.is_boolean(compressor)) {
            map = native_fns.Boolean;
        } else if (exp.is_number(compressor)) {
            map = native_fns.Number;
        } else if (exp instanceof AST_RegExp) {
            map = native_fns.RegExp;
        } else if (exp.is_string(compressor)) {
            map = native_fns.String;
            if (prop == "replace") {
                var arg = this.args[1];
                if (arg && !arg.is_string(compressor)) return false;
            }
        } else if (!dot.may_throw_on_access(compressor)) {
            map = native_fns.Object;
        }
        return map && map[prop];
    });

    // determine if object spread syntax may cause runtime exception
    (function(def) {
        def(AST_Node, return_false);
        def(AST_Array, return_true);
        def(AST_Assign, function() {
            switch (this.operator) {
              case "=":
                return this.right.safe_to_spread();
              case "&&=":
              case "||=":
              case "??=":
                return this.left.safe_to_spread() && this.right.safe_to_spread();
            }
            return true;
        });
        def(AST_Binary, function() {
            return !lazy_op[this.operator] || this.left.safe_to_spread() && this.right.safe_to_spread();
        });
        def(AST_Constant, return_true);
        def(AST_Lambda, return_true);
        def(AST_Object, function() {
            return all(this.properties, function(prop) {
                return !(prop instanceof AST_ObjectGetter || prop instanceof AST_Spread);
            });
        });
        def(AST_Sequence, function() {
            return this.tail_node().safe_to_spread();
        });
        def(AST_SymbolRef, function() {
            var fixed = this.fixed_value();
            return fixed && fixed.safe_to_spread();
        });
        def(AST_Unary, return_true);
    })(function(node, func) {
        node.DEFMETHOD("safe_to_spread", func);
    });

    // determine if expression has side effects
    (function(def) {
        function any(list, compressor, spread) {
            return !all(list, spread ? function(node) {
                return node instanceof AST_Spread ? !spread(node, compressor) : !node.has_side_effects(compressor);
            } : function(node) {
                return !node.has_side_effects(compressor);
            });
        }
        function array_spread(node, compressor) {
            var exp = node.expression;
            return !exp.is_string(compressor) || exp.has_side_effects(compressor);
        }
        def(AST_Node, return_true);
        def(AST_Array, function(compressor) {
            return any(this.elements, compressor, array_spread);
        });
        def(AST_Assign, function(compressor) {
            var lhs = this.left;
            if (!(lhs instanceof AST_PropAccess)) return true;
            var node = lhs.expression;
            return !(node instanceof AST_ObjectIdentity)
                || !node.scope.resolve().new
                || lhs instanceof AST_Sub && lhs.property.has_side_effects(compressor)
                || this.right.has_side_effects(compressor);
        });
        def(AST_Binary, function(compressor) {
            return this.left.has_side_effects(compressor)
                || this.right.has_side_effects(compressor)
                || !can_drop_op(this.operator, this.right, compressor);
        });
        def(AST_Block, function(compressor) {
            return any(this.body, compressor);
        });
        def(AST_Call, function(compressor) {
            if (!this.is_expr_pure(compressor)
                && (!this.is_call_pure(compressor) || this.expression.has_side_effects(compressor))) {
                return true;
            }
            return any(this.args, compressor, array_spread);
        });
        def(AST_Case, function(compressor) {
            return this.expression.has_side_effects(compressor)
                || any(this.body, compressor);
        });
        def(AST_Class, function(compressor) {
            var base = this.extends;
            if (base) {
                if (base instanceof AST_SymbolRef) base = base.fixed_value();
                if (!safe_for_extends(base)) return true;
            }
            return any(this.properties, compressor);
        });
        def(AST_ClassProperty, function(compressor) {
            return this.key instanceof AST_Node && this.key.has_side_effects(compressor)
                || this.static && this.value && this.value.has_side_effects(compressor);
        });
        def(AST_Conditional, function(compressor) {
            return this.condition.has_side_effects(compressor)
                || this.consequent.has_side_effects(compressor)
                || this.alternative.has_side_effects(compressor);
        });
        def(AST_Constant, return_false);
        def(AST_Definitions, function(compressor) {
            return any(this.definitions, compressor);
        });
        def(AST_DestructuredArray, function(compressor) {
            return any(this.elements, compressor);
        });
        def(AST_DestructuredKeyVal, function(compressor) {
            return this.key instanceof AST_Node && this.key.has_side_effects(compressor)
                || this.value.has_side_effects(compressor);
        });
        def(AST_DestructuredObject, function(compressor) {
            return any(this.properties, compressor);
        });
        def(AST_Dot, function(compressor) {
            return this.expression.may_throw_on_access(compressor)
                || this.expression.has_side_effects(compressor);
        });
        def(AST_EmptyStatement, return_false);
        def(AST_If, function(compressor) {
            return this.condition.has_side_effects(compressor)
                || this.body && this.body.has_side_effects(compressor)
                || this.alternative && this.alternative.has_side_effects(compressor);
        });
        def(AST_LabeledStatement, function(compressor) {
            return this.body.has_side_effects(compressor);
        });
        def(AST_Lambda, return_false);
        def(AST_Object, function(compressor) {
            return any(this.properties, compressor, function(node, compressor) {
                var exp = node.expression;
                return !exp.safe_to_spread() || exp.has_side_effects(compressor);
            });
        });
        def(AST_ObjectIdentity, return_false);
        def(AST_ObjectProperty, function(compressor) {
            return this.key instanceof AST_Node && this.key.has_side_effects(compressor)
                || this.value.has_side_effects(compressor);
        });
        def(AST_Sequence, function(compressor) {
            return any(this.expressions, compressor);
        });
        def(AST_SimpleStatement, function(compressor) {
            return this.body.has_side_effects(compressor);
        });
        def(AST_Sub, function(compressor) {
            return this.expression.may_throw_on_access(compressor)
                || this.expression.has_side_effects(compressor)
                || this.property.has_side_effects(compressor);
        });
        def(AST_Switch, function(compressor) {
            return this.expression.has_side_effects(compressor)
                || any(this.body, compressor);
        });
        def(AST_SymbolDeclaration, return_false);
        def(AST_SymbolRef, function(compressor) {
            return !this.is_declared(compressor) || !can_drop_symbol(this, compressor);
        });
        def(AST_Template, function(compressor) {
            return !this.is_expr_pure(compressor) || any(this.expressions, compressor);
        });
        def(AST_Try, function(compressor) {
            return any(this.body, compressor)
                || this.bcatch && this.bcatch.has_side_effects(compressor)
                || this.bfinally && this.bfinally.has_side_effects(compressor);
        });
        def(AST_Unary, function(compressor) {
            return unary_side_effects[this.operator]
                || this.expression.has_side_effects(compressor);
        });
        def(AST_VarDef, function() {
            return this.value;
        });
    })(function(node, func) {
        node.DEFMETHOD("has_side_effects", func);
    });

    // determine if expression may throw
    (function(def) {
        def(AST_Node, return_true);

        def(AST_Constant, return_false);
        def(AST_EmptyStatement, return_false);
        def(AST_Lambda, return_false);
        def(AST_ObjectIdentity, return_false);
        def(AST_SymbolDeclaration, return_false);

        function any(list, compressor) {
            for (var i = list.length; --i >= 0;)
                if (list[i].may_throw(compressor))
                    return true;
            return false;
        }

        function call_may_throw(exp, compressor) {
            if (exp.may_throw(compressor)) return true;
            if (exp instanceof AST_SymbolRef) exp = exp.fixed_value();
            if (!(exp instanceof AST_Lambda)) return true;
            if (any(exp.argnames, compressor)) return true;
            if (any(exp.body, compressor)) return true;
            return is_arrow(exp) && exp.value && exp.value.may_throw(compressor);
        }

        def(AST_Array, function(compressor) {
            return any(this.elements, compressor);
        });
        def(AST_Assign, function(compressor) {
            if (this.right.may_throw(compressor)) return true;
            if (!compressor.has_directive("use strict")
                && this.operator == "="
                && this.left instanceof AST_SymbolRef) {
                return false;
            }
            return this.left.may_throw(compressor);
        });
        def(AST_Await, function(compressor) {
            return this.expression.may_throw(compressor);
        });
        def(AST_Binary, function(compressor) {
            return this.left.may_throw(compressor)
                || this.right.may_throw(compressor)
                || !can_drop_op(this.operator, this.right, compressor);
        });
        def(AST_Block, function(compressor) {
            return any(this.body, compressor);
        });
        def(AST_Call, function(compressor) {
            if (any(this.args, compressor)) return true;
            if (this.is_expr_pure(compressor)) return false;
            this.may_throw = return_true;
            var ret = call_may_throw(this.expression, compressor);
            delete this.may_throw;
            return ret;
        });
        def(AST_Case, function(compressor) {
            return this.expression.may_throw(compressor)
                || any(this.body, compressor);
        });
        def(AST_Conditional, function(compressor) {
            return this.condition.may_throw(compressor)
                || this.consequent.may_throw(compressor)
                || this.alternative.may_throw(compressor);
        });
        def(AST_DefaultValue, function(compressor) {
            return this.name.may_throw(compressor)
                || this.value && this.value.may_throw(compressor);
        });
        def(AST_Definitions, function(compressor) {
            return any(this.definitions, compressor);
        });
        def(AST_Dot, function(compressor) {
            return !this.optional && this.expression.may_throw_on_access(compressor)
                || this.expression.may_throw(compressor);
        });
        def(AST_ForEnumeration, function(compressor) {
            if (this.init.may_throw(compressor)) return true;
            var obj = this.object;
            if (obj.may_throw(compressor)) return true;
            obj = obj.tail_node();
            if (!(obj instanceof AST_Array || obj.is_string(compressor))) return true;
            return this.body.may_throw(compressor);
        });
        def(AST_If, function(compressor) {
            return this.condition.may_throw(compressor)
                || this.body && this.body.may_throw(compressor)
                || this.alternative && this.alternative.may_throw(compressor);
        });
        def(AST_LabeledStatement, function(compressor) {
            return this.body.may_throw(compressor);
        });
        def(AST_Object, function(compressor) {
            return any(this.properties, compressor);
        });
        def(AST_ObjectProperty, function(compressor) {
            return this.value.may_throw(compressor)
                || this.key instanceof AST_Node && this.key.may_throw(compressor);
        });
        def(AST_Return, function(compressor) {
            return this.value && this.value.may_throw(compressor);
        });
        def(AST_Sequence, function(compressor) {
            return any(this.expressions, compressor);
        });
        def(AST_SimpleStatement, function(compressor) {
            return this.body.may_throw(compressor);
        });
        def(AST_Sub, function(compressor) {
            return !this.optional && this.expression.may_throw_on_access(compressor)
                || this.expression.may_throw(compressor)
                || this.property.may_throw(compressor);
        });
        def(AST_Switch, function(compressor) {
            return this.expression.may_throw(compressor)
                || any(this.body, compressor);
        });
        def(AST_SymbolRef, function(compressor) {
            return !this.is_declared(compressor) || !can_drop_symbol(this, compressor);
        });
        def(AST_Template, function(compressor) {
            if (any(this.expressions, compressor)) return true;
            if (this.is_expr_pure(compressor)) return false;
            if (!this.tag) return false;
            this.may_throw = return_true;
            var ret = call_may_throw(this.tag, compressor);
            delete this.may_throw;
            return ret;
        });
        def(AST_Try, function(compressor) {
            return (this.bcatch ? this.bcatch.may_throw(compressor) : any(this.body, compressor))
                || this.bfinally && this.bfinally.may_throw(compressor);
        });
        def(AST_Unary, function(compressor) {
            return this.expression.may_throw(compressor)
                && !(this.operator == "typeof" && this.expression instanceof AST_SymbolRef);
        });
        def(AST_VarDef, function(compressor) {
            return this.name.may_throw(compressor)
                || this.value && this.value.may_throw(compressor);
        });
    })(function(node, func) {
        node.DEFMETHOD("may_throw", func);
    });

    // determine if expression is constant
    (function(def) {
        function all_constant(list, scope) {
            for (var i = list.length; --i >= 0;)
                if (!list[i].is_constant_expression(scope))
                    return false;
            return true;
        }
        def(AST_Node, return_false);
        def(AST_Array, function(scope) {
            return all_constant(this.elements, scope);
        });
        def(AST_Binary, function(scope) {
            return this.left.is_constant_expression(scope)
                && this.right.is_constant_expression(scope)
                && can_drop_op(this.operator, this.right);
        });
        def(AST_Class, function(scope) {
            var base = this.extends;
            if (base && !safe_for_extends(base)) return false;
            return all_constant(this.properties, scope);
        });
        def(AST_ClassProperty, function(scope) {
            return typeof this.key == "string" && (!this.value || this.value.is_constant_expression(scope));
        });
        def(AST_Constant, return_true);
        def(AST_Lambda, function(scope) {
            var self = this;
            var result = true;
            var scopes = [];
            self.walk(new TreeWalker(function(node, descend) {
                if (!result) return true;
                if (node instanceof AST_BlockScope) {
                    if (node === self) return;
                    scopes.push(node);
                    descend();
                    scopes.pop();
                    return true;
                }
                if (node instanceof AST_SymbolRef) {
                    if (self.inlined || node.redef || node.in_arg) {
                        result = false;
                        return true;
                    }
                    if (self.variables.has(node.name)) return true;
                    var def = node.definition();
                    if (member(def.scope, scopes)) return true;
                    if (scope && !def.redefined()) {
                        var scope_def = scope.find_variable(node.name);
                        if (scope_def ? scope_def === def : def.undeclared) {
                            result = "f";
                            return true;
                        }
                    }
                    result = false;
                    return true;
                }
                if (node instanceof AST_ObjectIdentity) {
                    if (is_arrow(self) && all(scopes, function(s) {
                        return !(s instanceof AST_Scope) || is_arrow(s);
                    })) result = false;
                    return true;
                }
            }));
            return result;
        });
        def(AST_Object, function(scope) {
            return all_constant(this.properties, scope);
        });
        def(AST_ObjectProperty, function(scope) {
            return typeof this.key == "string" && this.value.is_constant_expression(scope);
        });
        def(AST_Unary, function(scope) {
            return this.expression.is_constant_expression(scope);
        });
    })(function(node, func) {
        node.DEFMETHOD("is_constant_expression", func);
    });

    // tell me if a statement aborts
    function aborts(thing) {
        return thing && thing.aborts();
    }
    (function(def) {
        def(AST_Statement, return_null);
        def(AST_Jump, return_this);
        function block_aborts() {
            var n = this.body.length;
            return n > 0 && aborts(this.body[n - 1]);
        }
        def(AST_BlockStatement, block_aborts);
        def(AST_SwitchBranch, block_aborts);
        def(AST_If, function() {
            return this.alternative && aborts(this.body) && aborts(this.alternative) && this;
        });
    })(function(node, func) {
        node.DEFMETHOD("aborts", func);
    });

    /* -----[ optimizers ]----- */

    var directives = makePredicate(["use asm", "use strict"]);
    OPT(AST_Directive, function(self, compressor) {
        if (compressor.option("directives")
            && (!directives[self.value] || compressor.has_directive(self.value) !== self)) {
            return make_node(AST_EmptyStatement, self);
        }
        return self;
    });

    OPT(AST_Debugger, function(self, compressor) {
        if (compressor.option("drop_debugger"))
            return make_node(AST_EmptyStatement, self);
        return self;
    });

    OPT(AST_LabeledStatement, function(self, compressor) {
        if (self.body instanceof AST_If || self.body instanceof AST_Break) {
            var body = tighten_body([ self.body ], compressor);
            switch (body.length) {
              case 0:
                self.body = make_node(AST_EmptyStatement, self);
                break;
              case 1:
                self.body = body[0];
                break;
              default:
                self.body = make_node(AST_BlockStatement, self, { body: body });
                break;
            }
        }
        return compressor.option("unused") && self.label.references.length == 0 ? self.body : self;
    });

    OPT(AST_LoopControl, function(self, compressor) {
        if (!compressor.option("dead_code")) return self;
        var label = self.label;
        if (label) {
            var lct = compressor.loopcontrol_target(self);
            self.label = null;
            if (compressor.loopcontrol_target(self) === lct) {
                remove(label.thedef.references, self);
            } else {
                self.label = label;
            }
        }
        return self;
    });

    OPT(AST_Block, function(self, compressor) {
        self.body = tighten_body(self.body, compressor);
        return self;
    });

    function trim_block(node, parent, in_list) {
        switch (node.body.length) {
          case 0:
            return in_list ? List.skip : make_node(AST_EmptyStatement, node);
          case 1:
            var stat = node.body[0];
            if (!safe_to_trim(stat)) return node;
            if (parent instanceof AST_IterationStatement && stat instanceof AST_LambdaDefinition) return node;
            return stat;
        }
        return node;
    }

    OPT(AST_BlockStatement, function(self, compressor) {
        self.body = tighten_body(self.body, compressor);
        return trim_block(self, compressor.parent());
    });

    function drop_rest_farg(fn, compressor) {
        if (!compressor.option("rests")) return;
        if (fn.uses_arguments) return;
        if (!(fn.rest instanceof AST_DestructuredArray)) return;
        if (!compressor.drop_fargs(fn, compressor.parent())) return;
        fn.argnames = fn.argnames.concat(fn.rest.elements);
        fn.rest = fn.rest.rest;
    }

    OPT(AST_Lambda, function(self, compressor) {
        drop_rest_farg(self, compressor);
        self.body = tighten_body(self.body, compressor);
        return self;
    });

    function opt_arrow(self, compressor) {
        if (!compressor.option("arrows")) return self;
        drop_rest_farg(self, compressor);
        if (self.value) self.body = [ self.first_statement() ];
        var body = tighten_body(self.body, compressor);
        switch (body.length) {
          case 1:
            var stat = body[0];
            if (stat instanceof AST_Return) {
                self.body.length = 0;
                self.value = stat.value;
                break;
            }
          default:
            self.body = body;
            self.value = null;
            break;
        }
        return self;
    }
    OPT(AST_Arrow, opt_arrow);
    OPT(AST_AsyncArrow, opt_arrow);

    OPT(AST_Function, function(self, compressor) {
        drop_rest_farg(self, compressor);
        self.body = tighten_body(self.body, compressor);
        var parent = compressor.parent();
        if (compressor.option("inline")) for (var i = 0; i < self.body.length; i++) {
            var stat = self.body[i];
            if (stat instanceof AST_Directive) continue;
            if (stat instanceof AST_Return) {
                if (i != self.body.length - 1) break;
                var call = stat.value;
                if (!call || call.TYPE != "Call") break;
                if (call.is_expr_pure(compressor)) break;
                var exp = call.expression, fn;
                if (!(exp instanceof AST_SymbolRef)) {
                    fn = exp;
                } else if (self.name && self.name.definition() === exp.definition()) {
                    break;
                } else {
                    fn = exp.fixed_value();
                }
                if (!(fn instanceof AST_Defun || fn instanceof AST_Function)) break;
                if (fn.rest) break;
                if (fn.uses_arguments) break;
                if (fn === exp) {
                    if (fn.parent_scope !== self) break;
                    if (!all(fn.enclosed, function(def) {
                        return def.scope !== self;
                    })) break;
                }
                if ((fn !== exp || fn.name)
                    && (parent instanceof AST_ClassMethod || parent instanceof AST_ObjectMethod)
                    && parent.value === compressor.self()) break;
                if (fn.contains_this()) break;
                var len = fn.argnames.length;
                if (len > 0 && compressor.option("inline") < 2) break;
                if (len > self.argnames.length) break;
                if (!all(self.argnames, function(argname) {
                    return argname instanceof AST_SymbolFunarg;
                })) break;
                if (!all(call.args, function(arg) {
                    return !(arg instanceof AST_Spread);
                })) break;
                for (var j = 0; j < len; j++) {
                    var arg = call.args[j];
                    if (!(arg instanceof AST_SymbolRef)) break;
                    if (arg.definition() !== self.argnames[j].definition()) break;
                }
                if (j < len) break;
                for (; j < call.args.length; j++) {
                    if (call.args[j].has_side_effects(compressor)) break;
                }
                if (j < call.args.length) break;
                if (len < self.argnames.length && !compressor.drop_fargs(self, parent)) {
                    if (!compressor.drop_fargs(fn, call)) break;
                    do {
                        fn.argnames.push(fn.make_var(AST_SymbolFunarg, fn, "argument_" + len));
                    } while (++len < self.argnames.length);
                }
                return exp;
            }
            break;
        }
        return self;
    });

    var NO_MERGE = makePredicate("arguments await yield");
    AST_Scope.DEFMETHOD("merge_variables", function(compressor) {
        if (!compressor.option("merge_vars")) return;
        var in_arg = [], in_try, root, segment = {}, self = this;
        var first = [], last = [], index = 0;
        var declarations = new Dictionary();
        var references = Object.create(null);
        var prev = Object.create(null);
        var tw = new TreeWalker(function(node, descend) {
            if (node instanceof AST_Assign) {
                var lhs = node.left;
                var rhs = node.right;
                if (lhs instanceof AST_Destructured) {
                    rhs.walk(tw);
                    walk_destructured(AST_SymbolRef, mark, lhs);
                    return true;
                }
                if (lazy_op[node.operator.slice(0, -1)]) {
                    lhs.walk(tw);
                    push();
                    rhs.walk(tw);
                    if (lhs instanceof AST_SymbolRef) mark(lhs);
                    pop();
                    return true;
                }
                if (lhs instanceof AST_SymbolRef) {
                    if (node.operator != "=") mark(lhs, true);
                    rhs.walk(tw);
                    mark(lhs);
                    return true;
                }
                return;
            }
            if (node instanceof AST_Binary) {
                if (!lazy_op[node.operator]) return;
                walk_cond(node);
                return true;
            }
            if (node instanceof AST_Break) {
                var target = tw.loopcontrol_target(node);
                if (!(target instanceof AST_IterationStatement)) insert(target);
                return true;
            }
            if (node instanceof AST_Call) {
                var exp = node.expression;
                if (exp instanceof AST_LambdaExpression) {
                    node.args.forEach(function(arg) {
                        arg.walk(tw);
                    });
                    exp.walk(tw);
                } else {
                    descend();
                    mark_expression(exp);
                }
                return true;
            }
            if (node instanceof AST_Class) {
                if (node.name) node.name.walk(tw);
                if (node.extends) node.extends.walk(tw);
                node.properties.filter(function(prop) {
                    if (prop.key instanceof AST_Node) prop.key.walk(tw);
                    return prop.value;
                }).forEach(function(prop) {
                    if (prop.static) {
                        prop.value.walk(tw);
                    } else {
                        push();
                        segment.block = node;
                        prop.value.walk(tw);
                        pop();
                    }
                });
                return true;
            }
            if (node instanceof AST_Conditional) {
                walk_cond(node.condition, node.consequent, node.alternative);
                return true;
            }
            if (node instanceof AST_Continue) {
                var target = tw.loopcontrol_target(node);
                if (target instanceof AST_Do) insert(target);
                return true;
            }
            if (node instanceof AST_Do) {
                push();
                segment.block = node;
                segment.loop = true;
                var save = segment;
                node.body.walk(tw);
                if (segment.inserted === node) segment = save;
                node.condition.walk(tw);
                pop();
                return true;
            }
            if (node instanceof AST_For) {
                if (node.init) node.init.walk(tw);
                push();
                segment.block = node;
                segment.loop = true;
                if (node.condition) node.condition.walk(tw);
                node.body.walk(tw);
                if (node.step) node.step.walk(tw);
                pop();
                return true;
            }
            if (node instanceof AST_ForEnumeration) {
                node.object.walk(tw);
                push();
                segment.block = node;
                segment.loop = true;
                node.init.walk(tw);
                node.body.walk(tw);
                pop();
                return true;
            }
            if (node instanceof AST_If) {
                walk_cond(node.condition, node.body, node.alternative);
                return true;
            }
            if (node instanceof AST_LabeledStatement) {
                push();
                segment.block = node;
                var save = segment;
                node.body.walk(tw);
                if (segment.inserted === node) segment = save;
                pop();
                return true;
            }
            if (node instanceof AST_Scope) {
                push();
                segment.block = node;
                if (node === self) root = segment;
                if (node instanceof AST_Lambda) {
                    if (node.name) references[node.name.definition().id] = false;
                    var marker = node.uses_arguments && !tw.has_directive("use strict") ? function(node) {
                        references[node.definition().id] = false;
                    } : function(node) {
                        mark(node);
                    };
                    in_arg.push(node);
                    node.argnames.forEach(function(argname) {
                        walk_destructured(AST_SymbolFunarg, marker, argname);
                    });
                    if (node.rest) walk_destructured(AST_SymbolFunarg, marker, node.rest);
                    in_arg.pop();
                }
                walk_lambda(node, tw);
                pop();
                return true;
            }
            if (node instanceof AST_Sub) {
                var exp = node.expression;
                if (node.optional) {
                    exp.walk(tw);
                    push();
                    node.property.walk(tw);
                    pop();
                } else {
                    descend();
                }
                mark_expression(exp);
                return true;
            }
            if (node instanceof AST_Switch) {
                node.expression.walk(tw);
                var save = segment;
                node.body.forEach(function(branch) {
                    if (branch instanceof AST_Default) return;
                    branch.expression.walk(tw);
                    if (save === segment) push();
                });
                segment = save;
                node.body.forEach(function(branch) {
                    push();
                    segment.block = node;
                    var save = segment;
                    walk_body(branch, tw);
                    if (segment.inserted === node) segment = save;
                    pop();
                });
                return true;
            }
            if (node instanceof AST_SymbolConst || node instanceof AST_SymbolLet) {
                references[node.definition().id] = false;
                return true;
            }
            if (node instanceof AST_SymbolRef) {
                mark(node, true);
                return true;
            }
            if (node instanceof AST_Try) {
                var save_try = in_try;
                in_try = node;
                walk_body(node, tw);
                if (node.bcatch) {
                    if (node.bcatch.argname) node.bcatch.argname.mark_symbol(function(node) {
                        if (node instanceof AST_SymbolCatch) {
                            var def = node.definition();
                            references[def.id] = false;
                            if (def = def.redefined()) references[def.id] = false;
                        }
                    }, tw);
                    if (node.bfinally || (in_try = save_try)) {
                        walk_body(node.bcatch, tw);
                    } else {
                        push();
                        walk_body(node.bcatch, tw);
                        pop();
                    }
                }
                in_try = save_try;
                if (node.bfinally) node.bfinally.walk(tw);
                return true;
            }
            if (node instanceof AST_Unary) {
                if (!UNARY_POSTFIX[node.operator]) return;
                var sym = node.expression;
                if (!(sym instanceof AST_SymbolRef)) return;
                mark(sym, true);
                return true;
            }
            if (node instanceof AST_VarDef) {
                var assigned = node.value;
                if (assigned) {
                    assigned.walk(tw);
                } else {
                    assigned = segment.block instanceof AST_ForEnumeration && segment.block.init === tw.parent();
                }
                walk_destructured(AST_SymbolDeclaration, assigned ? function(node) {
                    if (node instanceof AST_SymbolVar) {
                        mark(node);
                    } else {
                        node.walk(tw);
                    }
                } : function(node) {
                    if (node instanceof AST_SymbolVar) {
                        var id = node.definition().id;
                        var refs = references[id];
                        if (refs) {
                            refs.push(node);
                        } else if (!(id in references)) {
                            declarations.add(id, node);
                        }
                    } else {
                        node.walk(tw);
                    }
                }, node.name);
                return true;
            }
            if (node instanceof AST_While) {
                push();
                segment.block = node;
                segment.loop = true;
                descend();
                pop();
                return true;
            }

            function mark_expression(exp) {
                if (!compressor.option("ie")) return;
                var sym = root_expr(exp);
                if (sym instanceof AST_SymbolRef) sym.walk(tw);
            }

            function walk_cond(condition, consequent, alternative) {
                var save = segment;
                var segments = [ save, save ];
                if (condition instanceof AST_Binary) switch (condition.operator) {
                  case "&&":
                    segments[0] = walk_cond(condition.left, condition.right)[0];
                    break;
                  case "||":
                  case "??":
                    segments[1] = walk_cond(condition.left, null, condition.right)[1];
                    break;
                  default:
                    condition.walk(tw);
                    break;
                } else if (condition instanceof AST_Conditional) {
                    walk_cond(condition.condition, condition.consequent, condition.alternative);
                } else {
                    condition.walk(tw);
                }
                segment = segments[0];
                if (consequent) {
                    push();
                    consequent.walk(tw);
                }
                segments[0] = segment;
                segment = segments[1];
                if (alternative) {
                    push();
                    alternative.walk(tw);
                }
                segments[1] = segment;
                segment = save;
                return segments;
            }
        });
        tw.directives = Object.create(compressor.directives);
        self.walk(tw);
        var changed = false;
        var merged = Object.create(null);
        while (first.length && last.length) {
            var tail = last.shift();
            if (!tail) continue;
            var def = tail.definition;
            var tail_refs = references[def.id];
            if (!tail_refs) continue;
            tail_refs = { end: tail_refs.end };
            while (def.id in merged) def = merged[def.id];
            tail_refs.start = references[def.id].start;
            var skipped = [];
            do {
                var head = first.shift();
                if (tail.index > head.index) continue;
                var prev_def = head.definition;
                if (!(prev_def.id in prev)) continue;
                var head_refs = references[prev_def.id];
                if (!head_refs) continue;
                if (head_refs.start.block !== tail_refs.start.block
                    || !mergeable(head_refs, tail_refs)
                    || (head_refs.start.loop || !same_scope(def)) && !mergeable(tail_refs, head_refs)
                    || compressor.option("webkit") && is_funarg(def) !== is_funarg(prev_def)
                    || prev_def.const_redefs
                    || !all(head_refs.scopes, function(scope) {
                        return scope.find_variable(def.name) === def;
                    })) {
                    skipped.push(head);
                    continue;
                }
                head_refs.forEach(function(sym) {
                    sym.thedef = def;
                    sym.name = def.name;
                    if (sym instanceof AST_SymbolRef) {
                        def.references.push(sym);
                        prev_def.replaced++;
                    } else {
                        def.orig.push(sym);
                        prev_def.eliminated++;
                    }
                });
                if (!prev_def.fixed) def.fixed = false;
                merged[prev_def.id] = def;
                changed = true;
                break;
            } while (first.length);
            if (skipped.length) first = skipped.concat(first);
        }
        return changed;

        function push() {
            segment = Object.create(segment);
        }

        function pop() {
            segment = Object.getPrototypeOf(segment);
        }

        function walk_destructured(symbol_type, mark, lhs) {
            var marker = new TreeWalker(function(node) {
                if (node instanceof AST_Destructured) return;
                if (node instanceof AST_DefaultValue) {
                    push();
                    node.value.walk(tw);
                    pop();
                    node.name.walk(marker);
                } else if (node instanceof AST_DestructuredKeyVal) {
                    if (!(node.key instanceof AST_Node)) {
                        node.value.walk(marker);
                    } else if (node.value instanceof AST_PropAccess) {
                        push();
                        segment.block = node;
                        node.key.walk(tw);
                        node.value.walk(marker);
                        pop();
                    } else {
                        node.key.walk(tw);
                        node.value.walk(marker);
                    }
                } else if (node instanceof symbol_type) {
                    mark(node);
                } else {
                    node.walk(tw);
                }
                return true;
            });
            lhs.walk(marker);
        }

        function mark(sym, read) {
            var def = sym.definition(), ldef;
            if (read && !all(in_arg, function(fn) {
                ldef = fn.variables.get(sym.name);
                if (!ldef) return true;
                if (!is_funarg(ldef)) return true;
                return ldef !== def
                    && !def.undeclared
                    && fn.parent_scope.find_variable(sym.name) !== def;
            })) return references[def.id] = references[ldef.id] = false;
            var seg = segment;
            if (in_try) {
                push();
                seg = segment;
                pop();
            }
            if (def.id in references) {
                var refs = references[def.id];
                if (!refs) return;
                if (refs.start.block !== seg.block) return references[def.id] = false;
                push_ref(sym);
                refs.end = seg;
                if (def.id in prev) {
                    last[prev[def.id]] = null;
                } else if (!read) {
                    return;
                }
            } else if ((ldef = self.variables.get(def.name)) !== def) {
                if (ldef && root === seg) references[ldef.id] = false;
                return references[def.id] = false;
            } else if (compressor.exposed(def) || NO_MERGE[sym.name]) {
                return references[def.id] = false;
            } else {
                var refs = declarations.get(def.id) || [];
                refs.scopes = [];
                push_ref(sym);
                references[def.id] = refs;
                if (!read) {
                    refs.start = seg;
                    return first.push({
                        index: index++,
                        definition: def,
                    });
                }
                if (seg.block !== self) return references[def.id] = false;
                refs.start = root;
            }
            prev[def.id] = last.length;
            last.push({
                index: index++,
                definition: def,
            });

            function push_ref(sym) {
                refs.push(sym);
                push_uniq(refs.scopes, sym.scope);
                var scope = find_scope(tw);
                if (scope !== sym.scope) push_uniq(refs.scopes, scope);
            }
        }

        function insert(target) {
            var stack = [];
            while (true) {
                if (HOP(segment, "block")) {
                    var block = segment.block;
                    if (block instanceof AST_LabeledStatement) block = block.body;
                    if (block === target) break;
                }
                stack.push(segment);
                pop();
            }
            segment.inserted = segment.block;
            push();
            while (stack.length) {
                var seg = stack.pop();
                push();
                if (HOP(seg, "block")) segment.block = seg.block;
                if (HOP(seg, "loop")) segment.loop = seg.loop;
            }
        }

        function must_visit(base, segment) {
            return base === segment || base.isPrototypeOf(segment);
        }

        function mergeable(head, tail) {
            return must_visit(head.start, head.end) || must_visit(head.start, tail.start);
        }
    });

    function fill_holes(orig, elements) {
        for (var i = elements.length; --i >= 0;) {
            if (!elements[i]) elements[i] = make_node(AST_Hole, orig);
        }
    }

    function to_class_expr(defcl, drop_name) {
        var cl = make_node(AST_ClassExpression, defcl);
        if (cl.name) cl.name = drop_name ? null : make_node(AST_SymbolClass, cl.name);
        return cl;
    }

    function to_func_expr(defun, drop_name) {
        var ctor;
        switch (defun.CTOR) {
          case AST_AsyncDefun:
            ctor = AST_AsyncFunction;
            break;
          case AST_AsyncGeneratorDefun:
            ctor = AST_AsyncGeneratorFunction;
            break;
          case AST_Defun:
            ctor = AST_Function;
            break;
          case AST_GeneratorDefun:
            ctor = AST_GeneratorFunction;
            break;
        }
        var fn = make_node(ctor, defun);
        fn.name = drop_name ? null : make_node(AST_SymbolLambda, defun.name);
        return fn;
    }

    AST_Scope.DEFMETHOD("drop_unused", function(compressor) {
        if (!compressor.option("unused")) return;
        var self = this;
        var drop_funcs = !(self instanceof AST_Toplevel) || compressor.toplevel.funcs;
        var drop_vars = !(self instanceof AST_Toplevel) || compressor.toplevel.vars;
        var assign_as_unused = /keep_assign/.test(compressor.option("unused")) ? return_false : function(node, props) {
            var sym, nested = false;
            if (node instanceof AST_Assign) {
                if (node.write_only || node.operator == "=") sym = extract_reference(node.left, props);
            } else if (node instanceof AST_Unary) {
                if (node.write_only) sym = extract_reference(node.expression, props);
            }
            if (!(sym instanceof AST_SymbolRef)) return;
            var def = sym.definition();
            if (export_defaults[def.id]) return;
            if (compressor.exposed(def)) return;
            if (!can_drop_symbol(sym, compressor, nested)) return;
            return sym;

            function extract_reference(node, props) {
                if (node instanceof AST_PropAccess) {
                    var expr = node.expression;
                    if (!expr.may_throw_on_access(compressor, true)) {
                        nested = true;
                        if (props && node instanceof AST_Sub) props.unshift(node.property);
                        return extract_reference(expr, props);
                    }
                } else if (node instanceof AST_Assign && node.operator == "=") {
                    node.write_only = "p";
                    var ref = extract_reference(node.right);
                    if (!props) return ref;
                    props.assign = node;
                    return ref instanceof AST_SymbolRef ? ref : node.left;
                }
                return node;
            }
        };
        var assign_in_use = Object.create(null);
        var export_defaults = Object.create(null);
        var find_variable = function(name) {
            find_variable = compose(self, 0, noop);
            return find_variable(name);

            function compose(child, level, find) {
                var parent = compressor.parent(level);
                if (!parent) return find;
                var in_arg = parent instanceof AST_Lambda && member(child, parent.argnames);
                return compose(parent, level + 1, in_arg ? function(name) {
                    var def = find(name);
                    if (def) return def;
                    def = parent.variables.get(name);
                    if (def) {
                        var sym = def.orig[0];
                        if (sym instanceof AST_SymbolFunarg || sym instanceof AST_SymbolLambda) return def;
                    }
                } : parent.variables ? function(name) {
                    return find(name) || parent.variables.get(name);
                } : find);
            }
        };
        var for_ins = Object.create(null);
        var in_use = [];
        var in_use_ids = Object.create(null); // avoid expensive linear scans of in_use
        var lambda_ids = Object.create(null);
        var value_read = Object.create(null);
        var value_modified = Object.create(null);
        var var_defs = Object.create(null);
        if (self instanceof AST_Toplevel && compressor.top_retain) {
            self.variables.each(function(def) {
                if (compressor.top_retain(def) && !(def.id in in_use_ids)) {
                    AST_Node.info("Retaining variable {name}", def);
                    in_use_ids[def.id] = true;
                    in_use.push(def);
                }
            });
        }
        var assignments = new Dictionary();
        var initializations = new Dictionary();
        // pass 1: find out which symbols are directly used in
        // this scope (not in nested scopes).
        var scope = this;
        var tw = new TreeWalker(function(node, descend) {
            if (node instanceof AST_Lambda && node.uses_arguments && !tw.has_directive("use strict")) {
                node.each_argname(function(argname) {
                    var def = argname.definition();
                    if (!(def.id in in_use_ids)) {
                        in_use_ids[def.id] = true;
                        in_use.push(def);
                    }
                });
            }
            if (node === self) return;
            if (scope === self) {
                if (node instanceof AST_DefClass) {
                    var def = node.name.definition();
                    var drop = drop_funcs && !def.exported;
                    if (!drop && !(def.id in in_use_ids)) {
                        in_use_ids[def.id] = true;
                        in_use.push(def);
                    }
                    var used = tw.parent() instanceof AST_ExportDefault;
                    if (used) {
                        export_defaults[def.id] = true;
                    } else if (drop && !(def.id in lambda_ids)) {
                        lambda_ids[def.id] = 1;
                    }
                    if (node.extends) node.extends.walk(tw);
                    var values = [];
                    node.properties.forEach(function(prop) {
                        if (prop.key instanceof AST_Node) prop.key.walk(tw);
                        var value = prop.value;
                        if (!value) return;
                        if (is_static_field_or_init(prop)) {
                            if (!used && value.contains_this()) used = true;
                            walk_class_prop(value);
                        } else {
                            values.push(value);
                        }
                    });
                    values.forEach(drop && used ? walk_class_prop : function(value) {
                        initializations.add(def.id, value);
                    });
                    return true;
                }
                if (node instanceof AST_LambdaDefinition) {
                    var def = node.name.definition();
                    var drop = drop_funcs && !def.exported;
                    if (!drop && !(def.id in in_use_ids)) {
                        in_use_ids[def.id] = true;
                        in_use.push(def);
                    }
                    initializations.add(def.id, node);
                    if (tw.parent() instanceof AST_ExportDefault) {
                        export_defaults[def.id] = true;
                        return scan_ref_scoped(node, descend, true);
                    }
                    if (drop && !(def.id in lambda_ids)) lambda_ids[def.id] = 1;
                    return true;
                }
                if (node instanceof AST_Definitions) {
                    node.definitions.forEach(function(defn) {
                        var value = defn.value;
                        var side_effects = value
                            && (defn.name instanceof AST_Destructured || value.has_side_effects(compressor));
                        var shared = side_effects && value.tail_node().operator == "=";
                        defn.name.mark_symbol(function(name) {
                            if (!(name instanceof AST_SymbolDeclaration)) return;
                            var def = name.definition();
                            var_defs[def.id] = (var_defs[def.id] || 0) + 1;
                            if (node instanceof AST_Var && def.orig[0] instanceof AST_SymbolCatch) {
                                var redef = def.redefined();
                                if (redef) var_defs[redef.id] = (var_defs[redef.id] || 0) + 1;
                            }
                            if (!(def.id in in_use_ids) && (!drop_vars || def.exported
                                || (node instanceof AST_Const ? def.redefined() : def.const_redefs)
                                || !(node instanceof AST_Var || is_safe_lexical(def)))) {
                                in_use_ids[def.id] = true;
                                in_use.push(def);
                            }
                            if (value) {
                                if (!side_effects) {
                                    initializations.add(def.id, value);
                                } else if (shared) {
                                    verify_safe_usage(def, name, value_modified[def.id]);
                                }
                                assignments.add(def.id, defn);
                            }
                            unmark_lambda(def);
                            return true;
                        }, tw);
                        if (side_effects) value.walk(tw);
                    });
                    return true;
                }
                if (node instanceof AST_SymbolFunarg) {
                    var def = node.definition();
                    var_defs[def.id] = (var_defs[def.id] || 0) + 1;
                    assignments.add(def.id, node);
                    return true;
                }
                if (node instanceof AST_SymbolImport) {
                    var def = node.definition();
                    if (!(def.id in in_use_ids) && (!drop_vars || !is_safe_lexical(def))) {
                        in_use_ids[def.id] = true;
                        in_use.push(def);
                    }
                    return true;
                }
            }
            return scan_ref_scoped(node, descend, true);

            function walk_class_prop(value) {
                var save_scope = scope;
                scope = node;
                value.walk(tw);
                scope = save_scope;
            }
        });
        tw.directives = Object.create(compressor.directives);
        self.walk(tw);
        var drop_fn_name = compressor.option("keep_fnames") ? return_false : compressor.option("ie") ? function(def) {
            return !compressor.exposed(def) && def.references.length == def.replaced;
        } : function(def) {
            if (!(def.id in in_use_ids)) return true;
            if (def.orig.length - def.eliminated < 2) return false;
            // function argument will always overshadow its name
            if (def.orig[1] instanceof AST_SymbolFunarg) return true;
            // retain if referenced within destructured object of argument
            return all(def.references, function(ref) {
                return !ref.in_arg;
            });
        };
        if (compressor.option("ie")) initializations.each(function(init, id) {
            if (id in in_use_ids) return;
            init.forEach(function(init) {
                init.walk(new TreeWalker(function(node) {
                    if (node instanceof AST_Function && node.name && !drop_fn_name(node.name.definition())) {
                        node.walk(tw);
                        return true;
                    }
                    if (node instanceof AST_Scope) return true;
                }));
            });
        });
        // pass 2: for every used symbol we need to walk its
        // initialization code to figure out if it uses other
        // symbols (that may not be in_use).
        tw = new TreeWalker(scan_ref_scoped);
        for (var i = 0; i < in_use.length; i++) {
            var init = initializations.get(in_use[i].id);
            if (init) init.forEach(function(init) {
                init.walk(tw);
            });
        }
        Object.keys(assign_in_use).forEach(function(id) {
            var assigns = assign_in_use[id];
            if (!assigns) {
                delete assign_in_use[id];
                return;
            }
            assigns = assigns.reduce(function(in_use, assigns) {
                assigns.forEach(function(assign) {
                    push_uniq(in_use, assign);
                });
                return in_use;
            }, []);
            var in_use = (assignments.get(id) || []).filter(function(node) {
                return find_if(node instanceof AST_Unary ? function(assign) {
                    return assign === node;
                } : function(assign) {
                    if (assign === node) return true;
                    if (assign instanceof AST_Unary) return false;
                    return get_rvalue(assign) === get_rvalue(node);
                }, assigns);
            });
            if (assigns.length == in_use.length) {
                assign_in_use[id] = in_use;
            } else {
                delete assign_in_use[id];
            }
        });
        // pass 3: we should drop declarations not in_use
        var calls_to_drop_args = [];
        var fns_with_marked_args = [];
        var trimmer = new TreeTransformer(function(node) {
            if (node instanceof AST_DefaultValue) return trim_default(trimmer, node);
            if (node instanceof AST_Destructured && node.rest) node.rest = node.rest.transform(trimmer);
            if (node instanceof AST_DestructuredArray) {
                var trim = !node.rest;
                for (var i = node.elements.length; --i >= 0;) {
                    var element = node.elements[i].transform(trimmer);
                    if (element) {
                        node.elements[i] = element;
                        trim = false;
                    } else if (trim) {
                        node.elements.pop();
                    } else {
                        node.elements[i] = make_node(AST_Hole, node.elements[i]);
                    }
                }
                return node;
            }
            if (node instanceof AST_DestructuredObject) {
                var properties = [];
                node.properties.forEach(function(prop) {
                    var retain = false;
                    if (prop.key instanceof AST_Node) {
                        prop.key = prop.key.transform(tt);
                        retain = prop.key.has_side_effects(compressor);
                    }
                    if ((retain || node.rest) && is_decl(prop.value)) {
                        prop.value = prop.value.transform(tt);
                        properties.push(prop);
                    } else {
                        var value = prop.value.transform(trimmer);
                        if (!value && node.rest) {
                            if (prop.value instanceof AST_DestructuredArray) {
                                value = make_node(AST_DestructuredArray, prop.value, { elements: [] });
                            } else {
                                value = make_node(AST_DestructuredObject, prop.value, { properties: [] });
                            }
                        }
                        if (value) {
                            prop.value = value;
                            properties.push(prop);
                        }
                    }
                });
                node.properties = properties;
                return node;
            }
            if (node instanceof AST_SymbolDeclaration) return trim_decl(node);
        });
        var tt = new TreeTransformer(function(node, descend, in_list) {
            var parent = tt.parent();
            if (drop_vars) {
                var props = [], sym = assign_as_unused(node, props);
                if (sym) {
                    var value;
                    if (can_drop_lhs(sym, node)) {
                        if (node instanceof AST_Assign) {
                            value = get_rhs(node);
                            if (node.write_only === true) value = value.drop_side_effect_free(compressor);
                        }
                        if (!value) value = make_node(AST_Number, node, { value: 0 });
                    }
                    if (value) {
                        if (props.assign) {
                            var assign = props.assign.drop_side_effect_free(compressor);
                            if (assign) {
                                assign.write_only = true;
                                props.unshift(assign);
                            }
                        }
                        if (!(parent instanceof AST_Sequence)
                            || parent.tail_node() === node
                            || value.has_side_effects(compressor)) {
                            props.push(value);
                        }
                        switch (props.length) {
                          case 0:
                            return List.skip;
                          case 1:
                            return maintain_this_binding(parent, node, props[0].transform(tt));
                          default:
                            return make_sequence(node, props.map(function(prop) {
                                return prop.transform(tt);
                            }));
                        }
                    }
                } else if (node instanceof AST_UnaryPostfix
                    && node.expression instanceof AST_SymbolRef
                    && indexOf_assign(node.expression.definition(), node) < 0) {
                    return make_node(AST_UnaryPrefix, node, {
                        operator: "+",
                        expression: node.expression,
                    });
                }
            }
            if (node instanceof AST_Binary && node.operator == "instanceof") {
                var sym = node.right;
                if (!(sym instanceof AST_SymbolRef)) return;
                if (sym.definition().id in in_use_ids) return;
                var lhs = node.left.drop_side_effect_free(compressor);
                var value = make_node(AST_False, node).optimize(compressor);
                return lhs ? make_sequence(node, [ lhs, value ]) : value;
            }
            if (node instanceof AST_Call) {
                calls_to_drop_args.push(node);
                node.args = node.args.map(function(arg) {
                    return arg.transform(tt);
                });
                node.expression = node.expression.transform(tt);
                return node;
            }
            if (scope !== self) return;
            if (drop_funcs && node !== self && node instanceof AST_DefClass) {
                var def = node.name.definition();
                if (!(def.id in in_use_ids)) {
                    log(node.name, "Dropping unused class {name}");
                    def.eliminated++;
                    descend(node, tt);
                    var trimmed = to_class_expr(node, true);
                    if (parent instanceof AST_ExportDefault) return trimmed;
                    trimmed = trimmed.drop_side_effect_free(compressor, true);
                    if (trimmed) return make_node(AST_SimpleStatement, node, { body: trimmed });
                    return in_list ? List.skip : make_node(AST_EmptyStatement, node);
                }
            }
            if (node instanceof AST_ClassExpression && node.name && drop_fn_name(node.name.definition())) {
                node.name = null;
            }
            if (node instanceof AST_Lambda) {
                if (drop_funcs && node !== self && node instanceof AST_LambdaDefinition) {
                    var def = node.name.definition();
                    if (!(def.id in in_use_ids)) {
                        log(node.name, "Dropping unused function {name}");
                        def.eliminated++;
                        if (parent instanceof AST_ExportDefault) {
                            descend_scope();
                            return to_func_expr(node, true);
                        }
                        return in_list ? List.skip : make_node(AST_EmptyStatement, node);
                    }
                }
                descend_scope();
                if (node instanceof AST_LambdaExpression && node.name && drop_fn_name(node.name.definition())) {
                    node.name = null;
                }
                if (!(node instanceof AST_Accessor)) {
                    var args, spread, trim = compressor.drop_fargs(node, parent);
                    if (trim && parent instanceof AST_Call && parent.expression === node) {
                        args = parent.args;
                        for (spread = 0; spread < args.length; spread++) {
                            if (args[spread] instanceof AST_Spread) break;
                        }
                    }
                    var argnames = node.argnames;
                    var rest = node.rest;
                    var after = false, before = false;
                    if (rest) {
                        before = true;
                        if (!args || spread < argnames.length || rest instanceof AST_SymbolFunarg) {
                            rest = rest.transform(trimmer);
                        } else {
                            var trimmed = trim_destructured(rest, make_node(AST_Array, parent, {
                                elements: args.slice(argnames.length),
                            }), trim_decl, !node.uses_arguments, rest);
                            rest = trimmed.name;
                            args.length = argnames.length;
                            if (trimmed.value.elements.length) [].push.apply(args, trimmed.value.elements);
                        }
                        if (rest instanceof AST_Destructured && !rest.rest) {
                            if (rest instanceof AST_DestructuredArray) {
                                if (rest.elements.length == 0) rest = null;
                            } else if (rest.properties.length == 0) {
                                rest = null;
                            }
                        }
                        node.rest = rest;
                        if (rest) {
                            trim = false;
                            after = true;
                        }
                    }
                    var default_length = trim ? -1 : node.length();
                    var trim_value = args && !node.uses_arguments && parent !== compressor.parent();
                    for (var i = argnames.length; --i >= 0;) {
                        var sym = argnames[i];
                        if (sym instanceof AST_SymbolFunarg) {
                            var def = sym.definition();
                            if (def.id in in_use_ids) {
                                trim = false;
                                if (indexOf_assign(def, sym) < 0) sym.unused = null;
                            } else if (trim) {
                                log(sym, "Dropping unused function argument {name}");
                                argnames.pop();
                                def.eliminated++;
                                sym.unused = true;
                            } else {
                                sym.unused = true;
                            }
                        } else {
                            before = true;
                            var funarg;
                            if (!args || spread < i) {
                                funarg = sym.transform(trimmer);
                            } else {
                                var trimmed = trim_destructured(sym, args[i], trim_decl, trim_value, sym);
                                funarg = trimmed.name;
                                if (trimmed.value) args[i] = trimmed.value;
                            }
                            if (funarg) {
                                trim = false;
                                argnames[i] = funarg;
                                if (!after) after = !(funarg instanceof AST_SymbolFunarg);
                            } else if (trim) {
                                log_default(sym, "Dropping unused default argument {name}");
                                argnames.pop();
                            } else if (i > default_length) {
                                log_default(sym, "Dropping unused default argument assignment {name}");
                                if (sym.name instanceof AST_SymbolFunarg) {
                                    sym.name.unused = true;
                                } else {
                                    after = true;
                                }
                                argnames[i] = sym.name;
                            } else {
                                log_default(sym, "Dropping unused default argument value {name}");
                                argnames[i] = sym = sym.clone();
                                sym.value = make_node(AST_Number, sym, { value: 0 });
                                after = true;
                            }
                        }
                    }
                    if (before && !after && node.uses_arguments && !tt.has_directive("use strict")) {
                        node.rest = make_node(AST_DestructuredArray, node, { elements: [] });
                    }
                    fns_with_marked_args.push(node);
                }
                return node;
            }
            if (node instanceof AST_Catch && node.argname instanceof AST_Destructured) {
                node.argname.transform(trimmer);
            }
            if (node instanceof AST_Definitions && !(parent instanceof AST_ForEnumeration && parent.init === node)) {
                // place uninitialized names at the start
                var body = [], head = [], tail = [];
                // for unused names whose initialization has
                // side effects, we can cascade the init. code
                // into the next one, or next statement.
                var side_effects = [];
                var duplicated = 0;
                var is_var = node instanceof AST_Var;
                node.definitions.forEach(function(def) {
                    if (def.value) def.value = def.value.transform(tt);
                    var value = def.value;
                    if (def.name instanceof AST_Destructured) {
                        var trimmed = trim_destructured(def.name, value, function(node) {
                            if (!drop_vars) return node;
                            if (node.definition().id in in_use_ids) return node;
                            if (is_catch(node)) return node;
                            if (is_var && !can_drop_symbol(node)) return node;
                            return null;
                        }, true);
                        if (trimmed.name) {
                            def = make_node(AST_VarDef, def, {
                                name: trimmed.name,
                                value: value = trimmed.value,
                            });
                            flush();
                        } else if (trimmed.value) {
                            side_effects.push(trimmed.value);
                        }
                        return;
                    }
                    var sym = def.name.definition();
                    var drop_sym = is_var ? can_drop_symbol(def.name) : is_safe_lexical(sym);
                    if (!drop_sym || !drop_vars || sym.id in in_use_ids) {
                        var index;
                        if (value && ((index = indexOf_assign(sym, def)) < 0 || self_assign(value.tail_node()))) {
                            def = def.clone();
                            value = value.drop_side_effect_free(compressor);
                            if (value) AST_Node.warn("Side effects in definition of variable {name} [{start}]", def.name);
                            if (node instanceof AST_Const) {
                                def.value = value || make_node(AST_Number, def, { value: 0 });
                            } else {
                                def.value = null;
                                if (value) side_effects.push(value);
                            }
                            value = null;
                            if (index >= 0) assign_in_use[sym.id][index] = def;
                        }
                        var old_def, fn;
                        if (!value && !(node instanceof AST_Let)) {
                            if (parent instanceof AST_ExportDeclaration) {
                                flush();
                            } else if (drop_sym && var_defs[sym.id] > 1) {
                                AST_Node.info("Dropping declaration of variable {name} [{start}]", def.name);
                                var_defs[sym.id]--;
                                sym.eliminated++;
                            } else {
                                head.push(def);
                            }
                        } else if (compressor.option("functions")
                            && !compressor.option("ie")
                            && drop_sym
                            && value
                            && var_defs[sym.id] == 1
                            && sym.assignments == 0
                            && (fn = value.tail_node()) instanceof AST_LambdaExpression
                            && !is_arguments(sym)
                            && !is_arrow(fn)
                            && assigned_once(fn, sym.references)
                            && can_declare_defun(fn)
                            && (old_def = rename_def(fn, def.name.name)) !== false) {
                            AST_Node.warn("Declaring {name} as function [{start}]", def.name);
                            var ctor;
                            switch (fn.CTOR) {
                              case AST_AsyncFunction:
                                ctor = AST_AsyncDefun;
                                break;
                              case AST_AsyncGeneratorFunction:
                                ctor = AST_AsyncGeneratorDefun;
                                break;
                              case AST_Function:
                                ctor = AST_Defun;
                                break;
                              case AST_GeneratorFunction:
                                ctor = AST_GeneratorDefun;
                                break;
                            }
                            var defun = make_node(ctor, fn);
                            defun.name = make_node(AST_SymbolDefun, def.name);
                            var name_def = def.name.scope.resolve().def_function(defun.name);
                            if (old_def) old_def.forEach(function(node) {
                                node.name = name_def.name;
                                node.thedef = name_def;
                                node.reference();
                            });
                            body.push(defun);
                            if (value !== fn) [].push.apply(side_effects, value.expressions.slice(0, -1));
                        } else {
                            if (drop_sym
                                && var_defs[sym.id] > 1
                                && !(parent instanceof AST_ExportDeclaration)
                                && sym.orig.indexOf(def.name) > sym.eliminated) {
                                var_defs[sym.id]--;
                                duplicated++;
                            }
                            flush();
                        }
                    } else if (is_catch(def.name)) {
                        value = value && value.drop_side_effect_free(compressor);
                        if (value) side_effects.push(value);
                        if (var_defs[sym.id] > 1) {
                            AST_Node.warn("Dropping duplicated declaration of variable {name} [{start}]", def.name);
                            var_defs[sym.id]--;
                            sym.eliminated++;
                        } else {
                            def.value = null;
                            head.push(def);
                        }
                    } else {
                        value = value && value.drop_side_effect_free(compressor);
                        if (value) {
                            AST_Node.warn("Side effects in initialization of unused variable {name} [{start}]", def.name);
                            side_effects.push(value);
                        } else {
                            log(def.name, "Dropping unused variable {name}");
                        }
                        sym.eliminated++;
                    }

                    function self_assign(ref) {
                        return ref instanceof AST_SymbolRef && ref.definition() === sym;
                    }

                    function assigned_once(fn, refs) {
                        if (refs.length == 0) return fn === def.name.fixed_value();
                        return all(refs, function(ref) {
                            return fn === ref.fixed_value();
                        });
                    }

                    function can_declare_defun(fn) {
                        if (!is_var || compressor.has_directive("use strict") || !(fn instanceof AST_Function)) {
                            return parent instanceof AST_Scope;
                        }
                        return parent instanceof AST_Block
                            || parent instanceof AST_For && parent.init === node
                            || parent instanceof AST_If;
                    }

                    function rename_def(fn, name) {
                        if (!fn.name) return null;
                        var def = fn.name.definition();
                        if (def.orig.length > 1) return null;
                        if (def.assignments > 0) return false;
                        if (def.name == name) return def;
                        if (compressor.option("keep_fnames")) return false;
                        var forbidden;
                        switch (name) {
                          case "await":
                            forbidden = is_async;
                            break;
                          case "yield":
                            forbidden = is_generator;
                            break;
                        }
                        return all(def.references, function(ref) {
                            var scope = ref.scope;
                            if (scope.find_variable(name) !== sym) return false;
                            if (forbidden) do {
                                scope = scope.resolve();
                                if (forbidden(scope)) return false;
                            } while (scope !== fn && (scope = scope.parent_scope));
                            return true;
                        }) && def;
                    }

                    function is_catch(node) {
                        var sym = node.definition();
                        return sym.orig[0] instanceof AST_SymbolCatch && sym.scope.resolve() === node.scope.resolve();
                    }

                    function flush() {
                        if (side_effects.length > 0) {
                            if (tail.length == 0) {
                                body.push(make_node(AST_SimpleStatement, node, {
                                    body: make_sequence(node, side_effects),
                                }));
                            } else if (value) {
                                side_effects.push(value);
                                def.value = make_sequence(value, side_effects);
                            } else {
                                def.value = make_node(AST_UnaryPrefix, def, {
                                    operator: "void",
                                    expression: make_sequence(def, side_effects),
                                });
                            }
                            side_effects = [];
                        }
                        tail.push(def);
                    }
                });
                switch (head.length) {
                  case 0:
                    if (tail.length == 0) break;
                    if (tail.length == duplicated) {
                        [].unshift.apply(side_effects, tail.map(function(def) {
                            AST_Node.info("Dropping duplicated definition of variable {name} [{start}]", def.name);
                            var sym = def.name.definition();
                            var ref = make_node(AST_SymbolRef, def.name);
                            sym.references.push(ref);
                            var assign = make_node(AST_Assign, def, {
                                operator: "=",
                                left: ref,
                                right: def.value,
                            });
                            var index = indexOf_assign(sym, def);
                            if (index >= 0) assign_in_use[sym.id][index] = assign;
                            sym.assignments++;
                            sym.eliminated++;
                            return assign;
                        }));
                        break;
                    }
                  case 1:
                    if (tail.length == 0) {
                        var id = head[0].name.definition().id;
                        if (id in for_ins) {
                            node.definitions = head;
                            for_ins[id].init = node;
                            break;
                        }
                    }
                  default:
                    var seq;
                    if (tail.length > 0 && (seq = tail[0].value) instanceof AST_Sequence) {
                        tail[0].value = seq.tail_node();
                        body.push(make_node(AST_SimpleStatement, node, {
                            body: make_sequence(seq, seq.expressions.slice(0, -1)),
                        }));
                    }
                    node.definitions = head.concat(tail);
                    body.push(node);
                }
                if (side_effects.length > 0) {
                    body.push(make_node(AST_SimpleStatement, node, { body: make_sequence(node, side_effects) }));
                }
                return insert_statements(body, node, in_list);
            }
            if (node instanceof AST_Assign) {
                descend(node, tt);
                if (!(node.left instanceof AST_Destructured)) return node;
                var trimmed = trim_destructured(node.left, node.right, function(node) {
                    return node;
                }, node.write_only === true);
                if (trimmed.name) return make_node(AST_Assign, node, {
                    operator: node.operator,
                    left: trimmed.name,
                    right: trimmed.value,
                });
                if (trimmed.value) return trimmed.value;
                if (parent instanceof AST_Sequence && parent.tail_node() !== node) return List.skip;
                return make_node(AST_Number, node, { value: 0 });
            }
            if (node instanceof AST_LabeledStatement && node.body instanceof AST_For) {
                // Certain combination of unused name + side effect leads to invalid AST:
                //    https://github.com/mishoo/UglifyJS/issues/1830
                // We fix it at this stage by moving the label inwards, back to the `for`.
                descend(node, tt);
                if (node.body instanceof AST_BlockStatement) {
                    var block = node.body;
                    node.body = block.body.pop();
                    block.body.push(node);
                    return in_list ? List.splice(block.body) : block;
                }
                return node;
            }
            if (node instanceof AST_Scope) {
                descend_scope();
                return node;
            }
            if (node instanceof AST_SymbolImport) {
                if (!compressor.option("imports") || node.definition().id in in_use_ids) return node;
                return in_list ? List.skip : null;
            }

            function descend_scope() {
                var save_scope = scope;
                scope = node;
                descend(node, tt);
                scope = save_scope;
            }
        }, function(node, in_list) {
            if (node instanceof AST_BlockStatement) return trim_block(node, tt.parent(), in_list);
            if (node instanceof AST_ExportDeclaration) {
                var block = node.body;
                if (!(block instanceof AST_BlockStatement)) return;
                node.body = block.body.pop();
                block.body.push(node);
                return in_list ? List.splice(block.body) : block;
            }
            if (node instanceof AST_For) return patch_for_init(node, in_list);
            if (node instanceof AST_ForIn) {
                if (!drop_vars || !compressor.option("loops")) return;
                if (!is_empty(node.body)) return;
                var sym = get_init_symbol(node);
                if (!sym) return;
                var def = sym.definition();
                if (def.id in in_use_ids) return;
                log(sym, "Dropping unused loop variable {name}");
                if (for_ins[def.id] === node) delete for_ins[def.id];
                var body = [];
                var value = node.object.drop_side_effect_free(compressor);
                if (value) {
                    AST_Node.warn("Side effects in object of for-in loop [{start}]", value);
                    body.push(make_node(AST_SimpleStatement, node, { body: value }));
                }
                if (node.init instanceof AST_Definitions && def.orig[0] instanceof AST_SymbolCatch) {
                    body.push(node.init);
                }
                return insert_statements(body, node, in_list);
            }
            if (node instanceof AST_Import) {
                if (node.properties && node.properties.length == 0) node.properties = null;
                return node;
            }
            if (node instanceof AST_Sequence) {
                if (node.expressions.length > 1) return;
                return maintain_this_binding(tt.parent(), node, node.expressions[0]);
            }
        });
        tt.push(compressor.parent());
        tt.directives = Object.create(compressor.directives);
        self.transform(tt);
        if (self instanceof AST_Lambda
            && self.body.length == 1
            && self.body[0] instanceof AST_Directive
            && self.body[0].value == "use strict") {
            self.body.length = 0;
        }
        calls_to_drop_args.forEach(function(call) {
            drop_unused_call_args(call, compressor, fns_with_marked_args);
        });

        function log(sym, text) {
            AST_Node[sym.definition().references.length > 0 ? "info" : "warn"](text + " [{start}]", sym);
        }

        function log_default(node, text) {
            if (node.name instanceof AST_SymbolFunarg) {
                log(node.name, text);
            } else {
                AST_Node.info(text + " [{start}]", node);
            }
        }

        function get_rvalue(expr) {
            return expr[expr instanceof AST_Assign ? "right" : "value"];
        }

        function insert_statements(body, orig, in_list) {
            switch (body.length) {
              case 0:
                return in_list ? List.skip : make_node(AST_EmptyStatement, orig);
              case 1:
                return body[0];
              default:
                return in_list ? List.splice(body) : make_node(AST_BlockStatement, orig, { body: body });
            }
        }

        function track_assigns(def, node) {
            if (def.scope.resolve() !== self) return false;
            if (!def.fixed || !node.fixed) assign_in_use[def.id] = false;
            return assign_in_use[def.id] !== false;
        }

        function add_assigns(def, node) {
            if (!assign_in_use[def.id]) assign_in_use[def.id] = [];
            if (node.fixed.assigns) push_uniq(assign_in_use[def.id], node.fixed.assigns);
        }

        function indexOf_assign(def, node) {
            var nodes = assign_in_use[def.id];
            return nodes && nodes.indexOf(node);
        }

        function unmark_lambda(def) {
            if (lambda_ids[def.id] > 1 && !(def.id in in_use_ids)) {
                in_use_ids[def.id] = true;
                in_use.push(def);
            }
            lambda_ids[def.id] = 0;
        }

        function verify_safe_usage(def, read, modified) {
            if (def.id in in_use_ids) return;
            if (read && modified) {
                in_use_ids[def.id] = read;
                in_use.push(def);
            } else {
                value_read[def.id] = read;
                value_modified[def.id] = modified;
            }
        }

        function can_drop_lhs(sym, node) {
            var def = sym.definition();
            var in_use = in_use_ids[def.id];
            if (!in_use) return true;
            if (node[node instanceof AST_Assign ? "left" : "expression"] !== sym) return false;
            return in_use === sym && def.references.length - def.replaced == 1 || indexOf_assign(def, node) < 0;
        }

        function get_rhs(assign) {
            var rhs = assign.right;
            if (!assign.write_only) return rhs;
            if (!(rhs instanceof AST_Binary && lazy_op[rhs.operator])) return rhs;
            if (!(rhs.left instanceof AST_SymbolRef)) return rhs;
            if (!(assign.left instanceof AST_SymbolRef)) return rhs;
            var def = assign.left.definition();
            if (rhs.left.definition() !== def) return rhs;
            if (rhs.right.has_side_effects(compressor)) return rhs;
            if (track_assigns(def, rhs.left)) add_assigns(def, rhs.left);
            return rhs.right;
        }

        function get_init_symbol(for_in) {
            var init = for_in.init;
            if (init instanceof AST_Definitions) {
                init = init.definitions[0].name;
                return init instanceof AST_SymbolDeclaration && init;
            }
            while (init instanceof AST_PropAccess) init = init.expression.tail_node();
            if (init instanceof AST_SymbolRef) return init;
        }

        function scan_ref_scoped(node, descend, init) {
            if (node instanceof AST_Assign && node.left instanceof AST_SymbolRef) {
                var def = node.left.definition();
                if (def.scope.resolve() === self) assignments.add(def.id, node);
            }
            if (node instanceof AST_SymbolRef && node.in_arg) var_defs[node.definition().id] = 0;
            if (node instanceof AST_Unary && node.expression instanceof AST_SymbolRef) {
                var def = node.expression.definition();
                if (def.scope.resolve() === self) assignments.add(def.id, node);
            }
            var props = [], sym = assign_as_unused(node, props);
            if (sym) {
                var node_def = sym.definition();
                if (node_def.scope.resolve() !== self && self.variables.get(sym.name) !== node_def) return;
                if (is_arguments(node_def) && !all(self.argnames, function(argname) {
                    return !argname.match_symbol(function(node) {
                        if (node instanceof AST_SymbolFunarg) {
                            var def = node.definition();
                            return def.references.length > def.replaced;
                        }
                    }, true);
                })) return;
                if (node.write_only === "p" && node.right.may_throw_on_access(compressor, true)) return;
                var assign = props.assign;
                if (assign) {
                    assign.write_only = true;
                    assign.walk(tw);
                }
                props.forEach(function(prop) {
                    prop.walk(tw);
                });
                if (node instanceof AST_Assign) {
                    var right = get_rhs(node), shared = false;
                    if (init && node.write_only === true && !right.has_side_effects(compressor)) {
                        initializations.add(node_def.id, right);
                    } else {
                        right.walk(tw);
                        shared = right.tail_node().operator == "=";
                    }
                    if (node.left === sym) {
                        if (!node.write_only || shared) {
                            verify_safe_usage(node_def, sym, value_modified[node_def.id]);
                        }
                    } else {
                        var fixed = sym.fixed_value();
                        if (!fixed || !fixed.is_constant()) {
                            verify_safe_usage(node_def, value_read[node_def.id], true);
                        }
                    }
                }
                if (track_assigns(node_def, sym) && is_lhs(sym, node) !== sym) add_assigns(node_def, sym);
                unmark_lambda(node_def);
                return true;
            }
            if (node instanceof AST_Binary) {
                if (node.operator != "instanceof") return;
                var sym = node.right;
                if (!(sym instanceof AST_SymbolRef)) return;
                var id = sym.definition().id;
                if (!lambda_ids[id]) return;
                node.left.walk(tw);
                lambda_ids[id]++;
                return true;
            }
            if (node instanceof AST_ForIn) {
                if (node.init instanceof AST_SymbolRef && scope === self) {
                    var id = node.init.definition().id;
                    if (!(id in for_ins)) for_ins[id] = node;
                }
                if (!drop_vars || !compressor.option("loops")) return;
                if (!is_empty(node.body)) return;
                if (node.init.has_side_effects(compressor)) return;
                var sym = get_init_symbol(node);
                if (!sym) return;
                var def = sym.definition();
                if (def.scope.resolve() !== self) {
                    var d = find_variable(sym.name);
                    if (d === def || d && d.redefined() === def) return;
                }
                node.object.walk(tw);
                return true;
            }
            if (node instanceof AST_SymbolRef) {
                var node_def = node.definition();
                if (!(node_def.id in in_use_ids)) {
                    in_use_ids[node_def.id] = true;
                    in_use.push(node_def);
                }
                if (cross_scope(node_def.scope, node.scope)) {
                    var redef = node_def.redefined();
                    if (redef && !(redef.id in in_use_ids)) {
                        in_use_ids[redef.id] = true;
                        in_use.push(redef);
                    }
                }
                if (track_assigns(node_def, node)) add_assigns(node_def, node);
                return true;
            }
            if (node instanceof AST_Scope) {
                var save_scope = scope;
                scope = node;
                descend();
                scope = save_scope;
                return true;
            }
        }

        function is_decl(node) {
            return (node instanceof AST_DefaultValue ? node.name : node) instanceof AST_SymbolDeclaration;
        }

        function trim_decl(node) {
            if (node.definition().id in in_use_ids) return node;
            if (node instanceof AST_SymbolFunarg) node.unused = true;
            return null;
        }

        function trim_default(trimmer, node) {
            node.value = node.value.transform(tt);
            var name = node.name.transform(trimmer);
            if (!name) {
                if (node.name instanceof AST_Destructured) return null;
                var value = node.value.drop_side_effect_free(compressor);
                if (!value) return null;
                log(node.name, "Side effects in default value of unused variable {name}");
                node = node.clone();
                node.name.unused = null;
                node.value = value;
            }
            return node;
        }

        function trim_destructured(node, value, process, drop, root) {
            var trimmer = new TreeTransformer(function(node) {
                if (node instanceof AST_DefaultValue) {
                    if (!(compressor.option("default_values") && value && value.is_defined(compressor))) {
                        var save_drop = drop;
                        drop = false;
                        var trimmed = trim_default(trimmer, node);
                        drop = save_drop;
                        if (!trimmed && drop && value) value = value.drop_side_effect_free(compressor);
                        return trimmed;
                    } else if (node === root) {
                        root = node = node.name;
                    } else {
                        node = node.name;
                    }
                }
                if (node instanceof AST_DestructuredArray) {
                    var save_drop = drop;
                    var save_value = value;
                    if (value instanceof AST_SymbolRef) {
                        drop = false;
                        value = value.fixed_value();
                    }
                    var native, values;
                    if (value instanceof AST_Array) {
                        native = true;
                        values = value.elements;
                    } else {
                        native = value && value.is_string(compressor);
                        values = false;
                    }
                    var elements = [], newValues = drop && [], pos = 0;
                    node.elements.forEach(function(element, index) {
                        value = values && values[index];
                        if (value instanceof AST_Hole) {
                            value = null;
                        } else if (value instanceof AST_Spread) {
                            if (drop) {
                                newValues.length = pos;
                                fill_holes(save_value, newValues);
                                [].push.apply(newValues, values.slice(index));
                                save_value.elements = newValues;
                            }
                            value = values = false;
                        }
                        element = element.transform(trimmer);
                        if (element) elements[pos] = element;
                        if (drop && value) newValues[pos] = value;
                        if (element || value || !drop || !values) pos++;
                    });
                    value = values && make_node(AST_Array, save_value, {
                        elements: values.slice(node.elements.length),
                    });
                    if (node.rest) {
                        var was_drop = drop;
                        drop = false;
                        node.rest = node.rest.transform(compressor.option("rests") ? trimmer : tt);
                        drop = was_drop;
                        if (node.rest) elements.length = pos;
                    }
                    if (drop) {
                        if (value && !node.rest) value = value.drop_side_effect_free(compressor);
                        if (value instanceof AST_Array) {
                            value = value.elements;
                        } else if (value instanceof AST_Sequence) {
                            value = value.expressions;
                        } else if (value) {
                            value = [ value ];
                        }
                        if (value && value.length) {
                            newValues.length = pos;
                            [].push.apply(newValues, value);
                        }
                    }
                    value = save_value;
                    drop = save_drop;
                    if (values && newValues) {
                        fill_holes(value, newValues);
                        value = value.clone();
                        value.elements = newValues;
                    }
                    if (!native) {
                        elements.length = node.elements.length;
                    } else if (!node.rest) switch (elements.length) {
                      case 0:
                        if (node === root) break;
                        if (drop) value = value.drop_side_effect_free(compressor);
                        return null;
                      case 1:
                        if (!drop) break;
                        if (node === root) break;
                        var sym = elements[0];
                        if (sym.has_side_effects(compressor)) break;
                        if (value.has_side_effects(compressor) && sym.match_symbol(function(node) {
                            return node instanceof AST_PropAccess;
                        })) break;
                        value = make_node(AST_Sub, node, {
                            expression: value,
                            property: make_node(AST_Number, node, { value: 0 }),
                        });
                        return sym;
                    }
                    fill_holes(node, elements);
                    node.elements = elements;
                    return node;
                }
                if (node instanceof AST_DestructuredObject) {
                    var save_drop = drop;
                    var save_value = value;
                    if (value instanceof AST_SymbolRef) {
                        drop = false;
                        value = value.fixed_value();
                    }
                    var prop_keys, prop_map, values;
                    if (value instanceof AST_Object) {
                        prop_keys = [];
                        prop_map = new Dictionary();
                        values = value.properties.map(function(prop, index) {
                            prop = prop.clone();
                            if (prop instanceof AST_Spread) {
                                prop_map = false;
                            } else {
                                var key = prop.key;
                                if (key instanceof AST_Node) key = key.evaluate(compressor, true);
                                if (key instanceof AST_Node) {
                                    prop_map = false;
                                } else if (prop_map && !(prop instanceof AST_ObjectSetter)) {
                                    prop_map.set(key, prop);
                                }
                                prop_keys[index] = key;
                            }
                            return prop;
                        });
                    }
                    if (node.rest) {
                        value = false;
                        node.rest = node.rest.transform(compressor.option("rests") ? trimmer : tt);
                    }
                    var can_drop = new Dictionary();
                    var drop_keys = drop && new Dictionary();
                    var properties = [];
                    node.properties.map(function(prop) {
                        var key = prop.key;
                        if (key instanceof AST_Node) {
                            prop.key = key = key.transform(tt);
                            key = key.evaluate(compressor, true);
                        }
                        if (key instanceof AST_Node) {
                            drop_keys = false;
                        } else {
                            can_drop.set(key, !can_drop.has(key));
                        }
                        return key;
                    }).forEach(function(key, index) {
                        var prop = node.properties[index], trimmed;
                        if (key instanceof AST_Node) {
                            drop = false;
                            value = false;
                            trimmed = prop.value.transform(trimmer) || retain_lhs(prop.value);
                        } else {
                            drop = drop_keys && can_drop.get(key);
                            var mapped = prop_map && prop_map.get(key);
                            if (mapped) {
                                value = mapped.value;
                                if (value instanceof AST_Accessor) value = false;
                            } else {
                                value = false;
                            }
                            trimmed = prop.value.transform(trimmer);
                            if (!trimmed) {
                                if (node.rest || retain_key(prop)) trimmed = retain_lhs(prop.value);
                                if (drop_keys && !drop_keys.has(key)) {
                                    if (mapped) {
                                        drop_keys.set(key, mapped);
                                        if (value === null) {
                                            prop_map.set(key, retain_key(mapped) && make_node(AST_ObjectKeyVal, mapped, {
                                                key: mapped.key,
                                                value: make_node(AST_Number, mapped, { value: 0 }),
                                            }));
                                        }
                                    } else {
                                        drop_keys.set(key, true);
                                    }
                                }
                            } else if (drop_keys) {
                                drop_keys.set(key, false);
                            }
                            if (value) mapped.value = value;
                        }
                        if (trimmed) {
                            prop.value = trimmed;
                            properties.push(prop);
                        }
                    });
                    value = save_value;
                    drop = save_drop;
                    if (drop_keys && prop_keys) {
                        value = value.clone();
                        value.properties = List(values, function(prop, index) {
                            if (prop instanceof AST_Spread) return prop;
                            var key = prop_keys[index];
                            if (key instanceof AST_Node) return prop;
                            if (drop_keys.has(key)) {
                                var mapped = drop_keys.get(key);
                                if (!mapped) return prop;
                                if (mapped === prop) return prop_map.get(key) || List.skip;
                            } else if (node.rest) {
                                return prop;
                            }
                            var trimmed = prop.value.drop_side_effect_free(compressor);
                            if (trimmed) {
                                prop.value = trimmed;
                                return prop;
                            }
                            return retain_key(prop) ? make_node(AST_ObjectKeyVal, prop, {
                                key: prop.key,
                                value: make_node(AST_Number, prop, { value: 0 }),
                            }) : List.skip;
                        });
                    }
                    if (value && !node.rest) switch (properties.length) {
                      case 0:
                        if (node === root) break;
                        if (value.may_throw_on_access(compressor, true)) break;
                        if (drop) value = value.drop_side_effect_free(compressor);
                        return null;
                      case 1:
                        if (!drop) break;
                        if (node === root) break;
                        var prop = properties[0];
                        if (prop.key instanceof AST_Node) break;
                        if (prop.value.has_side_effects(compressor)) break;
                        if (value.has_side_effects(compressor) && prop.value.match_symbol(function(node) {
                            return node instanceof AST_PropAccess;
                        })) break;
                        value = make_node(AST_Sub, node, {
                            expression: value,
                            property: make_node_from_constant(prop.key, prop),
                        });
                        return prop.value;
                    }
                    node.properties = properties;
                    return node;
                }
                if (node instanceof AST_Hole) {
                    node = null;
                } else {
                    node = process(node);
                }
                if (!node && drop && value) value = value.drop_side_effect_free(compressor);
                return node;
            });
            return {
                name: node.transform(trimmer),
                value: value,
            };

            function retain_key(prop) {
                return prop.key instanceof AST_Node && prop.key.has_side_effects(compressor);
            }

            function clear_write_only(node) {
                if (node instanceof AST_Assign) {
                    node.write_only = false;
                    clear_write_only(node.right);
                } else if (node instanceof AST_Binary) {
                    if (!lazy_op[node.operator]) return;
                    clear_write_only(node.left);
                    clear_write_only(node.right);
                } else if (node instanceof AST_Conditional) {
                    clear_write_only(node.consequent);
                    clear_write_only(node.alternative);
                } else if (node instanceof AST_Sequence) {
                    clear_write_only(node.tail_node());
                } else if (node instanceof AST_Unary) {
                    node.write_only = false;
                }
            }

            function retain_lhs(node) {
                if (node instanceof AST_DefaultValue) return retain_lhs(node.name);
                if (node instanceof AST_Destructured) {
                    if (value === null) {
                        value = make_node(AST_Number, node, { value: 0 });
                    } else if (value) {
                        if (value.may_throw_on_access(compressor, true)) {
                            value = make_node(AST_Array, node, {
                                elements: value instanceof AST_Sequence ? value.expressions : [ value ],
                            });
                        } else {
                            clear_write_only(value);
                        }
                    }
                    return make_node(AST_DestructuredObject, node, { properties: [] });
                }
                node.unused = null;
                return node;
            }
        }
    });

    AST_Scope.DEFMETHOD("hoist_declarations", function(compressor) {
        if (compressor.has_directive("use asm")) return;
        var hoist_funs = compressor.option("hoist_funs");
        var hoist_vars = compressor.option("hoist_vars");
        var self = this;
        if (hoist_vars) {
            // let's count var_decl first, we seem to waste a lot of
            // space if we hoist `var` when there's only one.
            var var_decl = 0;
            self.walk(new TreeWalker(function(node) {
                if (var_decl > 1) return true;
                if (node instanceof AST_ExportDeclaration) return true;
                if (node instanceof AST_Scope && node !== self) return true;
                if (node instanceof AST_Var) {
                    var_decl++;
                    return true;
                }
            }));
            if (var_decl <= 1) hoist_vars = false;
        }
        if (!hoist_funs && !hoist_vars) return;
        var consts = new Dictionary();
        var dirs = [];
        var hoisted = [];
        var vars = new Dictionary();
        var tt = new TreeTransformer(function(node, descend, in_list) {
            if (node === self) return;
            if (node instanceof AST_Directive) {
                dirs.push(node);
                return in_list ? List.skip : make_node(AST_EmptyStatement, node);
            }
            if (node instanceof AST_LambdaDefinition) {
                if (!hoist_funs) return node;
                var p = tt.parent();
                if (p instanceof AST_ExportDeclaration) return node;
                if (p instanceof AST_ExportDefault) return node;
                if (p !== self && compressor.has_directive("use strict")) return node;
                hoisted.push(node);
                return in_list ? List.skip : make_node(AST_EmptyStatement, node);
            }
            if (node instanceof AST_Var) {
                if (!hoist_vars) return node;
                var p = tt.parent();
                if (p instanceof AST_ExportDeclaration) return node;
                if (!all(node.definitions, function(defn) {
                    var sym = defn.name;
                    return sym instanceof AST_SymbolVar
                        && !consts.has(sym.name)
                        && self.find_variable(sym.name) === sym.definition();
                })) return node;
                node.definitions.forEach(function(defn) {
                    vars.set(defn.name.name, defn);
                });
                var seq = node.to_assignments();
                if (p instanceof AST_ForEnumeration && p.init === node) {
                    if (seq) return seq;
                    var sym = node.definitions[0].name;
                    return make_node(AST_SymbolRef, sym);
                }
                if (p instanceof AST_For && p.init === node) return seq;
                if (!seq) return in_list ? List.skip : make_node(AST_EmptyStatement, node);
                return make_node(AST_SimpleStatement, node, { body: seq });
            }
            if (node instanceof AST_Scope) return node;
            if (node instanceof AST_SymbolConst) {
                consts.set(node.name, true);
                return node;
            }
        });
        self.transform(tt);
        if (vars.size() > 0) {
            // collect only vars which don't show up in self's arguments list
            var defns = [];
            if (self instanceof AST_Lambda) self.each_argname(function(argname) {
                if (all(argname.definition().references, function(ref) {
                    return !ref.in_arg;
                })) vars.del(argname.name);
            });
            vars.each(function(defn, name) {
                defn = defn.clone();
                defn.name = defn.name.clone();
                defn.value = null;
                defns.push(defn);
                vars.set(name, defn);
                defn.name.definition().orig.unshift(defn.name);
            });
            if (defns.length > 0) hoisted.push(make_node(AST_Var, self, { definitions: defns }));
        }
        self.body = dirs.concat(hoisted, self.body);
    });

    function scan_local_returns(fn, transform) {
        fn.walk(new TreeWalker(function(node) {
            if (node instanceof AST_Return) {
                transform(node);
                return true;
            }
            if (node instanceof AST_Scope && node !== fn) return true;
        }));
    }

    function map_self_returns(fn) {
        var map = Object.create(null);
        scan_local_returns(fn, function(node) {
            var value = node.value;
            if (value) value = value.tail_node();
            if (value instanceof AST_SymbolRef) {
                var id = value.definition().id;
                map[id] = (map[id] || 0) + 1;
            }
        });
        return map;
    }

    function can_trim_returns(def, self_returns, compressor) {
        if (compressor.exposed(def)) return false;
        switch (def.references.length - def.replaced - (self_returns[def.id] || 0)) {
          case def.drop_return:
            return "d";
          case def.bool_return:
            return true;
        }
    }

    function process_boolean_returns(fn, compressor) {
        scan_local_returns(fn, function(node) {
            node.in_bool = true;
            var value = node.value;
            if (value) {
                var ev = fuzzy_eval(compressor, value);
                if (!ev) {
                    value = value.drop_side_effect_free(compressor);
                    node.value = value ? make_sequence(node.value, [
                        value,
                        make_node(AST_Number, node.value, { value: 0 }),
                    ]) : null;
                } else if (!(ev instanceof AST_Node)) {
                    value = value.drop_side_effect_free(compressor);
                    node.value = value ? make_sequence(node.value, [
                        value,
                        make_node(AST_Number, node.value, { value: 1 }),
                    ]) : make_node(AST_Number, node.value, { value: 1 });
                }
            }
        });
    }

    AST_Scope.DEFMETHOD("process_returns", noop);
    AST_Defun.DEFMETHOD("process_returns", function(compressor) {
        if (!compressor.option("booleans")) return;
        if (compressor.parent() instanceof AST_ExportDefault) return;
        switch (can_trim_returns(this.name.definition(), map_self_returns(this), compressor)) {
          case "d":
            drop_returns(compressor, this, true);
            break;
          case true:
            process_boolean_returns(this, compressor);
            break;
        }
    });
    AST_Function.DEFMETHOD("process_returns", function(compressor) {
        if (!compressor.option("booleans")) return;
        var drop = true;
        var self_returns = map_self_returns(this);
        if (this.name && !can_trim(this.name.definition())) return;
        var parent = compressor.parent();
        if (parent instanceof AST_Assign) {
            if (parent.operator != "=") return;
            var sym = parent.left;
            if (!(sym instanceof AST_SymbolRef)) return;
            if (!can_trim(sym.definition())) return;
        } else if (parent instanceof AST_Call && parent.expression !== this) {
            var exp = parent.expression;
            if (exp instanceof AST_SymbolRef) exp = exp.fixed_value();
            if (!(exp instanceof AST_Lambda)) return;
            if (exp.uses_arguments || exp.pinned()) return;
            var args = parent.args, sym;
            for (var i = 0; i < args.length; i++) {
                var arg = args[i];
                if (arg === this) {
                    sym = exp.argnames[i];
                    if (!sym && exp.rest) return;
                    break;
                }
                if (arg instanceof AST_Spread) return;
            }
            if (sym instanceof AST_DefaultValue) sym = sym.name;
            if (sym instanceof AST_SymbolFunarg && !can_trim(sym.definition())) return;
        } else if (parent.TYPE == "Call") {
            compressor.pop();
            var in_bool = compressor.in_boolean_context();
            compressor.push(this);
            switch (in_bool) {
              case true:
                drop = false;
              case "d":
                break;
              default:
                return;
            }
        } else return;
        if (drop) {
            drop_returns(compressor, this, true);
        } else {
            process_boolean_returns(this, compressor);
        }

        function can_trim(def) {
            switch (can_trim_returns(def, self_returns, compressor)) {
              case true:
                drop = false;
              case "d":
                return true;
            }
        }
    });

    AST_BlockScope.DEFMETHOD("var_names", function() {
        var var_names = this._var_names;
        if (!var_names) {
            this._var_names = var_names = new Dictionary();
            this.enclosed.forEach(function(def) {
                var_names.set(def.name, true);
            });
            this.variables.each(function(def, name) {
                var_names.set(name, true);
            });
        }
        return var_names;
    });

    AST_Scope.DEFMETHOD("make_var", function(type, orig, prefix) {
        var scopes = [ this ];
        if (orig instanceof AST_SymbolDeclaration) orig.definition().references.forEach(function(ref) {
            var s = ref.scope;
            do {
                if (!push_uniq(scopes, s)) return;
                s = s.parent_scope;
            } while (s && s !== this);
        });
        prefix = prefix.replace(/^[^a-z_$]|[^a-z0-9_$]/gi, "_");
        var name = prefix;
        for (var i = 0; !all(scopes, function(scope) {
            return !scope.var_names().has(name);
        }); i++) name = prefix + "$" + i;
        var sym = make_node(type, orig, {
            name: name,
            scope: this,
        });
        var def = this.def_variable(sym);
        scopes.forEach(function(scope) {
            scope.enclosed.push(def);
            scope.var_names().set(name, true);
        });
        return sym;
    });

    AST_Scope.DEFMETHOD("hoist_properties", function(compressor) {
        if (!compressor.option("hoist_props") || compressor.has_directive("use asm")) return;
        var self = this;
        if (is_arrow(self) && self.value) return;
        var top_retain = self instanceof AST_Toplevel && compressor.top_retain || return_false;
        var defs_by_id = Object.create(null);
        var tt = new TreeTransformer(function(node, descend) {
            if (node instanceof AST_Assign) {
                if (node.operator != "=") return;
                if (!node.write_only) return;
                if (!can_hoist(node.left, node.right, 1)) return;
                descend(node, tt);
                var defs = new Dictionary();
                var assignments = [];
                var decls = [];
                node.right.properties.forEach(function(prop) {
                    var decl = make_sym(AST_SymbolVar, node.left, prop.key);
                    decls.push(make_node(AST_VarDef, node, {
                        name: decl,
                        value: null,
                    }));
                    var sym = make_node(AST_SymbolRef, node, {
                        name: decl.name,
                        scope: self,
                        thedef: decl.definition(),
                    });
                    sym.reference();
                    assignments.push(make_node(AST_Assign, node, {
                        operator: "=",
                        left: sym,
                        right: prop.value,
                    }));
                });
                defs.value = node.right;
                defs_by_id[node.left.definition().id] = defs;
                self.body.splice(self.body.indexOf(tt.stack[1]) + 1, 0, make_node(AST_Var, node, {
                    definitions: decls,
                }));
                return make_sequence(node, assignments);
            }
            if (node instanceof AST_Scope) {
                if (node === self) return;
                var parent = tt.parent();
                if (parent.TYPE == "Call" && parent.expression === node) return;
                return node;
            }
            if (node instanceof AST_VarDef) {
                if (!can_hoist(node.name, node.value, 0)) return;
                descend(node, tt);
                var defs = new Dictionary();
                var var_defs = [];
                var decl = node.clone();
                decl.value = node.name instanceof AST_SymbolConst ? make_node(AST_Number, node, { value: 0 }) : null;
                var_defs.push(decl);
                node.value.properties.forEach(function(prop) {
                    var_defs.push(make_node(AST_VarDef, node, {
                        name: make_sym(node.name.CTOR, node.name, prop.key),
                        value: prop.value,
                    }));
                });
                defs.value = node.value;
                defs_by_id[node.name.definition().id] = defs;
                return List.splice(var_defs);
            }

            function make_sym(type, sym, key) {
                var new_var = self.make_var(type, sym, sym.name + "_" + key);
                defs.set(key, new_var.definition());
                return new_var;
            }
        });
        self.transform(tt);
        self.transform(new TreeTransformer(function(node, descend) {
            if (node instanceof AST_PropAccess) {
                if (!(node.expression instanceof AST_SymbolRef)) return;
                var defs = defs_by_id[node.expression.definition().id];
                if (!defs) return;
                if (node.expression.fixed_value() !== defs.value) return;
                var def = defs.get(node.get_property());
                var sym = make_node(AST_SymbolRef, node, {
                    name: def.name,
                    scope: node.expression.scope,
                    thedef: def,
                });
                sym.reference();
                return sym;
            }
            if (node instanceof AST_SymbolRef) {
                var defs = defs_by_id[node.definition().id];
                if (!defs) return;
                if (node.fixed_value() !== defs.value) return;
                return make_node(AST_Object, node, { properties: [] });
            }
        }));

        function can_hoist(sym, right, count) {
            if (!(sym instanceof AST_Symbol)) return;
            var def = sym.definition();
            if (def.assignments != count) return;
            if (def.references.length - def.replaced == count) return;
            if (def.single_use) return;
            if (self.find_variable(sym.name) !== def) return;
            if (top_retain(def)) return;
            if (sym.fixed_value() !== right) return;
            var fixed = sym.fixed || def.fixed;
            if (fixed.direct_access) return;
            if (fixed.escaped && fixed.escaped.depth == 1) return;
            return right instanceof AST_Object
                && right.properties.length > 0
                && can_drop_symbol(sym, compressor)
                && all(right.properties, function(prop) {
                    return can_hoist_property(prop) && prop.key !== "__proto__";
                });
        }
    });

    function fn_name_unused(fn, compressor) {
        if (!fn.name || !compressor.option("ie")) return true;
        var def = fn.name.definition();
        if (compressor.exposed(def)) return false;
        return all(def.references, function(sym) {
            return !(sym instanceof AST_SymbolRef);
        });
    }

    function drop_returns(compressor, exp, ignore_name) {
        if (!(exp instanceof AST_Lambda)) return;
        var arrow = is_arrow(exp);
        var async = is_async(exp);
        var changed = false;
        var drop_body = false;
        if (arrow && compressor.option("arrows")) {
            if (!exp.value) {
                drop_body = true;
            } else if (!async || needs_enqueuing(compressor, exp.value)) {
                var dropped = exp.value.drop_side_effect_free(compressor);
                if (dropped !== exp.value) {
                    changed = true;
                    exp.value = dropped;
                }
            }
        } else if (!is_generator(exp)) {
            if (!ignore_name && exp.name) {
                var def = exp.name.definition();
                drop_body = def.references.length == def.replaced;
            } else {
                drop_body = true;
            }
        }
        if (drop_body) {
            exp.process_expression(false, function(node) {
                var value = node.value;
                if (value) {
                    if (async && !needs_enqueuing(compressor, value)) return node;
                    value = value.drop_side_effect_free(compressor, true);
                }
                changed = true;
                if (!value) return make_node(AST_EmptyStatement, node);
                return make_node(AST_SimpleStatement, node, { body: value });
            });
            scan_local_returns(exp, function(node) {
                var value = node.value;
                if (value) {
                    if (async && !needs_enqueuing(compressor, value)) return;
                    var dropped = value.drop_side_effect_free(compressor);
                    if (dropped !== value) {
                        changed = true;
                        if (dropped && async && !needs_enqueuing(compressor, dropped)) {
                            dropped = dropped.negate(compressor);
                        }
                        node.value = dropped;
                    }
                }
            });
        }
        if (async && compressor.option("awaits")) {
            if (drop_body) exp.process_expression("awaits", function(node) {
                var body = node.body;
                if (body instanceof AST_Await) {
                    if (needs_enqueuing(compressor, body.expression)) {
                        changed = true;
                        body = body.expression.drop_side_effect_free(compressor, true);
                        if (!body) return make_node(AST_EmptyStatement, node);
                        node.body = body;
                    }
                } else if (body instanceof AST_Sequence) {
                    var exprs = body.expressions;
                    for (var i = exprs.length; --i >= 0;) {
                        var tail = exprs[i];
                        if (!(tail instanceof AST_Await)) break;
                        var value = tail.expression;
                        if (!needs_enqueuing(compressor, value)) break;
                        changed = true;
                        if (exprs[i] = value.drop_side_effect_free(compressor)) break;
                    }
                    switch (i) {
                      case -1:
                        return make_node(AST_EmptyStatement, node);
                      case 0:
                        node.body = exprs[0];
                        break;
                      default:
                        exprs.length = i + 1;
                        break;
                    }
                }
                return node;
            });
            var abort = !drop_body && exp.name || arrow && exp.value && !needs_enqueuing(compressor, exp.value);
            var tw = new TreeWalker(function(node) {
                if (abort) return true;
                if (tw.parent() === exp && node.may_throw(compressor)) return abort = true;
                if (node instanceof AST_Await) return abort = true;
                if (node instanceof AST_ForAwaitOf) return abort = true;
                if (node instanceof AST_Return) {
                    if (node.value && !needs_enqueuing(compressor, node.value)) return abort = true;
                    return;
                }
                if (node instanceof AST_Scope && node !== exp) return true;
            });
            exp.walk(tw);
            if (!abort) {
                var ctor;
                switch (exp.CTOR) {
                  case AST_AsyncArrow:
                    ctor = AST_Arrow;
                    break;
                  case AST_AsyncFunction:
                    ctor = AST_Function;
                    break;
                  case AST_AsyncGeneratorFunction:
                    ctor = AST_GeneratorFunction;
                    break;
                }
                return make_node(ctor, exp);
            }
        }
        return changed && exp.clone();
    }

    // drop_side_effect_free()
    // remove side-effect-free parts which only affects return value
    (function(def) {
        // Drop side-effect-free elements from an array of expressions.
        // Returns an array of expressions with side-effects or null
        // if all elements were dropped. Note: original array may be
        // returned if nothing changed.
        function trim(nodes, compressor, first_in_statement, spread) {
            var len = nodes.length;
            var ret = [], changed = false;
            for (var i = 0; i < len; i++) {
                var node = nodes[i];
                var trimmed;
                if (spread && node instanceof AST_Spread) {
                    trimmed = spread(node, compressor, first_in_statement);
                } else {
                    trimmed = node.drop_side_effect_free(compressor, first_in_statement);
                }
                if (trimmed !== node) changed = true;
                if (trimmed) {
                    ret.push(trimmed);
                    first_in_statement = false;
                }
            }
            return ret.length ? changed ? ret : nodes : null;
        }
        function array_spread(node, compressor, first_in_statement) {
            var exp = node.expression;
            if (!exp.is_string(compressor)) return node;
            return exp.drop_side_effect_free(compressor, first_in_statement);
        }
        function convert_spread(node) {
            return node instanceof AST_Spread ? make_node(AST_Array, node, { elements: [ node ] }) : node;
        }
        def(AST_Node, return_this);
        def(AST_Accessor, return_null);
        def(AST_Array, function(compressor, first_in_statement) {
            var values = trim(this.elements, compressor, first_in_statement, array_spread);
            if (!values) return null;
            if (values === this.elements && all(values, function(node) {
                return node instanceof AST_Spread;
            })) return this;
            return make_sequence(this, values.map(convert_spread));
        });
        def(AST_Assign, function(compressor) {
            var left = this.left;
            if (left instanceof AST_PropAccess) {
                var expr = left.expression;
                if (expr.may_throw_on_access(compressor, true)) return this;
                if (compressor.has_directive("use strict") && expr.is_constant()) return this;
            }
            if (left.has_side_effects(compressor)) return this;
            if (lazy_op[this.operator.slice(0, -1)]) return this;
            this.write_only = true;
            if (!root_expr(left).is_constant_expression(compressor.find_parent(AST_Scope))) return this;
            return this.right.drop_side_effect_free(compressor);
        });
        def(AST_Await, function(compressor) {
            if (!compressor.option("awaits")) return this;
            var exp = this.expression;
            if (!needs_enqueuing(compressor, exp)) return this;
            if (exp instanceof AST_UnaryPrefix && exp.operator == "!") exp = exp.expression;
            var dropped = exp.drop_side_effect_free(compressor);
            if (dropped === exp) return this;
            if (!dropped) {
                dropped = make_node(AST_Number, exp, { value: 0 });
            } else if (!needs_enqueuing(compressor, dropped)) {
                dropped = dropped.negate(compressor);
            }
            var node = this.clone();
            node.expression = dropped;
            return node;
        });
        def(AST_Binary, function(compressor, first_in_statement) {
            var left = this.left;
            var right = this.right;
            var op = this.operator;
            if (!can_drop_op(op, right, compressor)) {
                var lhs = left.drop_side_effect_free(compressor, first_in_statement);
                if (lhs === left) return this;
                var node = this.clone();
                node.left = lhs || make_node(AST_Number, left, { value: 0 });
                return node;
            }
            var rhs = right.drop_side_effect_free(compressor, first_in_statement);
            if (!rhs) return left.drop_side_effect_free(compressor, first_in_statement);
            if (lazy_op[op] && rhs.has_side_effects(compressor)) {
                var node = this;
                if (rhs !== right) {
                    node = node.clone();
                    node.right = rhs.drop_side_effect_free(compressor);
                }
                if (op == "??") return node;
                var negated = node.clone();
                negated.operator = op == "&&" ? "||" : "&&";
                negated.left = left.negate(compressor, first_in_statement);
                var negated_rhs = negated.right.tail_node();
                if (negated_rhs instanceof AST_Binary && negated.operator == negated_rhs.operator) swap_chain(negated);
                var best = first_in_statement ? best_of_statement : best_of_expression;
                return op == "&&" ? best(node, negated) : best(negated, node);
            }
            var lhs = left.drop_side_effect_free(compressor, first_in_statement);
            if (!lhs) return rhs;
            rhs = rhs.drop_side_effect_free(compressor);
            if (!rhs) return lhs;
            return make_sequence(this, [ lhs, rhs ]);
        });
        function assign_this_only(fn, compressor) {
            fn.new = true;
            var result = all(fn.body, function(stat) {
                return !stat.has_side_effects(compressor);
            }) && all(fn.argnames, function(argname) {
                return !argname.match_symbol(return_false);
            }) && !(fn.rest && fn.rest.match_symbol(return_false));
            fn.new = false;
            return result;
        }
        def(AST_Call, function(compressor, first_in_statement) {
            var self = this;
            if (self.is_expr_pure(compressor)) {
                if (self.pure) AST_Node.warn("Dropping __PURE__ call [{start}]", self);
                var args = trim(self.args, compressor, first_in_statement, array_spread);
                return args && make_sequence(self, args.map(convert_spread));
            }
            var exp = self.expression;
            if (self.is_call_pure(compressor)) {
                var exprs = self.args.slice();
                exprs.unshift(exp.expression);
                exprs = trim(exprs, compressor, first_in_statement, array_spread);
                return exprs && make_sequence(self, exprs.map(convert_spread));
            }
            if (compressor.option("yields") && is_generator(exp)) {
                var call = self.clone();
                call.expression = make_node(AST_Function, exp);
                call.expression.body = [];
                var opt = call.transform(compressor);
                if (opt !== call) return opt.drop_side_effect_free(compressor, first_in_statement);
            }
            var dropped = drop_returns(compressor, exp);
            if (dropped) {
                // always shallow clone to ensure stripping of negated IIFEs
                self = self.clone();
                self.expression = dropped;
                // avoid extraneous traversal
                if (exp._squeezed) self.expression._squeezed = true;
            }
            if (self instanceof AST_New) {
                var fn = exp;
                if (fn instanceof AST_SymbolRef) fn = fn.fixed_value();
                if (fn instanceof AST_Lambda) {
                    if (assign_this_only(fn, compressor)) {
                        var exprs = self.args.slice();
                        exprs.unshift(exp);
                        exprs = trim(exprs, compressor, first_in_statement, array_spread);
                        return exprs && make_sequence(self, exprs.map(convert_spread));
                    }
                    if (!fn.contains_this()) {
                        self = make_node(AST_Call, self);
                        self.expression = self.expression.clone();
                        self.args = self.args.slice();
                    }
                }
            }
            self.call_only = true;
            return self;
        });
        def(AST_ClassExpression, function(compressor, first_in_statement) {
            var self = this;
            var exprs = [], values = [], init = 0;
            var props = self.properties;
            for (var i = 0; i < props.length; i++) {
                var prop = props[i];
                if (prop.key instanceof AST_Node) exprs.push(prop.key);
                if (!is_static_field_or_init(prop)) continue;
                var value = prop.value;
                if (!value.has_side_effects(compressor)) continue;
                if (value.contains_this()) return self;
                if (prop instanceof AST_ClassInit) {
                    init++;
                    values.push(prop);
                } else {
                    values.push(value);
                }
            }
            var base = self.extends;
            if (base) {
                if (base instanceof AST_SymbolRef) base = base.fixed_value();
                base = !safe_for_extends(base);
                if (!base) exprs.unshift(self.extends);
            }
            exprs = trim(exprs, compressor, first_in_statement);
            if (exprs) first_in_statement = false;
            values = trim(values, compressor, first_in_statement);
            if (!exprs) {
                if (!base && !values && !self.name) return null;
                exprs = [];
            }
            if (base || self.name || !compressor.has_directive("use strict")) {
                var node = to_class_expr(self);
                if (!base) node.extends = null;
                node.properties = [];
                if (values) {
                    if (values.length == init) {
                        if (exprs.length) values.unshift(make_node(AST_ClassField, self, {
                            key: make_sequence(self, exprs),
                            value: null,
                        }));
                        node.properties = values;
                    } else node.properties.push(make_node(AST_ClassField, self, {
                        static: true,
                        key: exprs.length ? make_sequence(self, exprs) : "c",
                        value: make_value(),
                    }));
                } else if (exprs.length) node.properties.push(make_node(AST_ClassMethod, self, {
                    key: make_sequence(self, exprs),
                    value: make_node(AST_Function, self, {
                        argnames: [],
                        body: [],
                    }).init_vars(node),
                }));
                return node;
            }
            if (values) exprs.push(make_node(AST_Call, self, {
                expression: make_node(AST_Arrow, self, {
                    argnames: [],
                    body: [],
                    value: make_value(),
                }).init_vars(self.parent_scope),
                args: [],
            }));
            return make_sequence(self, exprs);

            function make_value() {
                return make_sequence(self, values.map(function(node) {
                    if (!(node instanceof AST_ClassInit)) return node;
                    var fn = make_node(AST_Arrow, node.value);
                    fn.argnames = [];
                    return make_node(AST_Call, node, {
                        expression: fn,
                        args: [],
                    });
                }));
            }
        });
        def(AST_Conditional, function(compressor) {
            var consequent = this.consequent.drop_side_effect_free(compressor);
            var alternative = this.alternative.drop_side_effect_free(compressor);
            if (consequent === this.consequent && alternative === this.alternative) return this;
            var exprs;
            if (compressor.option("ie")) {
                exprs = [];
                if (consequent instanceof AST_Function) {
                    exprs.push(consequent);
                    consequent = null;
                }
                if (alternative instanceof AST_Function) {
                    exprs.push(alternative);
                    alternative = null;
                }
            }
            var node;
            if (!consequent) {
                node = alternative ? make_node(AST_Binary, this, {
                    operator: "||",
                    left: this.condition,
                    right: alternative,
                }) : this.condition.drop_side_effect_free(compressor);
            } else if (!alternative) {
                node = make_node(AST_Binary, this, {
                    operator: "&&",
                    left: this.condition,
                    right: consequent,
                });
            } else {
                node = this.clone();
                node.consequent = consequent;
                node.alternative = alternative;
            }
            if (!exprs) return node;
            if (node) exprs.push(node);
            return exprs.length == 0 ? null : make_sequence(this, exprs);
        });
        def(AST_Constant, return_null);
        def(AST_Dot, function(compressor, first_in_statement) {
            var expr = this.expression;
            if (expr.may_throw_on_access(compressor)) return this;
            return expr.drop_side_effect_free(compressor, first_in_statement);
        });
        def(AST_Function, function(compressor) {
            return fn_name_unused(this, compressor) ? null : this;
        });
        def(AST_LambdaExpression, return_null);
        def(AST_Object, function(compressor, first_in_statement) {
            var exprs = [];
            this.properties.forEach(function(prop) {
                if (prop instanceof AST_Spread) {
                    exprs.push(prop);
                } else {
                    if (prop.key instanceof AST_Node) exprs.push(prop.key);
                    exprs.push(prop.value);
                }
            });
            var values = trim(exprs, compressor, first_in_statement, function(node, compressor, first_in_statement) {
                var exp = node.expression;
                return exp.safe_to_spread() ? exp.drop_side_effect_free(compressor, first_in_statement) : node;
            });
            if (!values) return null;
            if (values === exprs && !all(values, function(node) {
                return !(node instanceof AST_Spread);
            })) return this;
            return make_sequence(this, values.map(function(node) {
                return node instanceof AST_Spread ? make_node(AST_Object, node, { properties: [ node ] }) : node;
            }));
        });
        def(AST_ObjectIdentity, return_null);
        def(AST_Sequence, function(compressor, first_in_statement) {
            var expressions = trim(this.expressions, compressor, first_in_statement);
            if (!expressions) return null;
            var end = expressions.length - 1;
            var last = expressions[end];
            if (compressor.option("awaits") && end > 0 && last instanceof AST_Await && last.expression.is_constant()) {
                expressions = expressions.slice(0, -1);
                end--;
                var expr = expressions[end];
                last.expression = needs_enqueuing(compressor, expr) ? expr : expr.negate(compressor);
                expressions[end] = last;
            }
            var assign, cond, lhs;
            if (compressor.option("conditionals")
                && end > 0
                && (assign = expressions[end - 1]) instanceof AST_Assign
                && assign.operator == "="
                && (lhs = assign.left) instanceof AST_SymbolRef
                && (cond = to_conditional_assignment(compressor, lhs.definition(), assign.right, last))) {
                assign = assign.clone();
                assign.right = cond;
                expressions = expressions.slice(0, -2);
                expressions.push(assign.drop_side_effect_free(compressor, first_in_statement));
            }
            return expressions === this.expressions ? this : make_sequence(this, expressions);
        });
        def(AST_Sub, function(compressor, first_in_statement) {
            var expr = this.expression;
            if (expr.may_throw_on_access(compressor)) return this;
            var prop = this.property;
            expr = expr.drop_side_effect_free(compressor, first_in_statement);
            if (!expr) return prop.drop_side_effect_free(compressor, first_in_statement);
            prop = prop.drop_side_effect_free(compressor);
            if (!prop) return expr;
            return make_sequence(this, [ expr, prop ]);
        });
        def(AST_SymbolRef, function(compressor) {
            return this.is_declared(compressor) && can_drop_symbol(this, compressor) ? null : this;
        });
        def(AST_Template, function(compressor, first_in_statement) {
            var self = this;
            if (self.is_expr_pure(compressor)) {
                var expressions = self.expressions;
                if (expressions.length == 0) return null;
                return make_sequence(self, expressions).drop_side_effect_free(compressor, first_in_statement);
            }
            var tag = self.tag;
            var dropped = drop_returns(compressor, tag);
            if (dropped) {
                // always shallow clone to signal internal changes
                self = self.clone();
                self.tag = dropped;
                // avoid extraneous traversal
                if (tag._squeezed) self.tag._squeezed = true;
            }
            return self;
        });
        def(AST_Unary, function(compressor, first_in_statement) {
            var exp = this.expression;
            if (unary_side_effects[this.operator]) {
                this.write_only = !exp.has_side_effects(compressor);
                return this;
            }
            if (this.operator == "typeof" && exp instanceof AST_SymbolRef && can_drop_symbol(exp, compressor)) {
                return null;
            }
            var node = exp.drop_side_effect_free(compressor, first_in_statement);
            if (first_in_statement && node && is_iife_call(node)) {
                if (node === exp && this.operator == "!") return this;
                return node.negate(compressor, first_in_statement);
            }
            return node;
        });
    })(function(node, func) {
        node.DEFMETHOD("drop_side_effect_free", func);
    });

    OPT(AST_SimpleStatement, function(self, compressor) {
        if (compressor.option("side_effects")) {
            var body = self.body;
            var node = body.drop_side_effect_free(compressor, true);
            if (!node) {
                AST_Node.warn("Dropping side-effect-free statement [{start}]", self);
                return make_node(AST_EmptyStatement, self);
            }
            if (node !== body) {
                return make_node(AST_SimpleStatement, self, { body: node });
            }
        }
        return self;
    });

    OPT(AST_While, function(self, compressor) {
        return compressor.option("loops") ? make_node(AST_For, self).optimize(compressor) : self;
    });

    function has_loop_control(loop, parent, type) {
        if (!type) type = AST_LoopControl;
        var found = false;
        var tw = new TreeWalker(function(node) {
            if (found || node instanceof AST_Scope) return true;
            if (node instanceof type && tw.loopcontrol_target(node) === loop) {
                return found = true;
            }
        });
        if (parent instanceof AST_LabeledStatement) tw.push(parent);
        tw.push(loop);
        loop.body.walk(tw);
        return found;
    }

    OPT(AST_Do, function(self, compressor) {
        if (!compressor.option("loops")) return self;
        var cond = fuzzy_eval(compressor, self.condition);
        if (!(cond instanceof AST_Node)) {
            if (cond && !has_loop_control(self, compressor.parent(), AST_Continue)) return make_node(AST_For, self, {
                body: make_node(AST_BlockStatement, self.body, {
                    body: [
                        self.body,
                        make_node(AST_SimpleStatement, self.condition, { body: self.condition }),
                    ],
                }),
            }).optimize(compressor);
            if (!has_loop_control(self, compressor.parent())) return make_node(AST_BlockStatement, self.body, {
                body: [
                    self.body,
                    make_node(AST_SimpleStatement, self.condition, { body: self.condition }),
                ],
            }).optimize(compressor);
        }
        if (self.body instanceof AST_BlockStatement && !has_loop_control(self, compressor.parent(), AST_Continue)) {
            var body = self.body.body;
            for (var i = body.length; --i >= 0;) {
                var stat = body[i];
                if (stat instanceof AST_If
                    && !stat.alternative
                    && stat.body instanceof AST_Break
                    && compressor.loopcontrol_target(stat.body) === self) {
                    if (has_block_scope_refs(stat.condition)) break;
                    self.condition = make_node(AST_Binary, self, {
                        operator: "&&",
                        left: stat.condition.negate(compressor),
                        right: self.condition,
                    });
                    body.splice(i, 1);
                } else if (stat instanceof AST_SimpleStatement) {
                    if (has_block_scope_refs(stat.body)) break;
                    self.condition = make_sequence(self, [
                        stat.body,
                        self.condition,
                    ]);
                    body.splice(i, 1);
                } else if (!is_declaration(stat, true)) {
                    break;
                }
            }
            self.body = trim_block(self.body, compressor.parent());
        }
        if (self.body instanceof AST_EmptyStatement) return make_node(AST_For, self).optimize(compressor);
        if (self.body instanceof AST_SimpleStatement) return make_node(AST_For, self, {
            condition: make_sequence(self.condition, [
                self.body.body,
                self.condition,
            ]),
            body: make_node(AST_EmptyStatement, self),
        }).optimize(compressor);
        return self;

        function has_block_scope_refs(node) {
            var found = false;
            node.walk(new TreeWalker(function(node) {
                if (found) return true;
                if (node instanceof AST_SymbolRef) {
                    if (!member(node.definition(), self.enclosed)) found = true;
                    return true;
                }
            }));
            return found;
        }
    });

    function if_break_in_loop(self, compressor) {
        var first = first_statement(self.body);
        if (compressor.option("dead_code")
            && (first instanceof AST_Break
                || first instanceof AST_Continue && external_target(first)
                || first instanceof AST_Exit)) {
            var body = [];
            if (is_statement(self.init)) {
                body.push(self.init);
            } else if (self.init) {
                body.push(make_node(AST_SimpleStatement, self.init, { body: self.init }));
            }
            var retain = external_target(first) || first instanceof AST_Exit;
            if (self.condition && retain) {
                body.push(make_node(AST_If, self, {
                    condition: self.condition,
                    body: first,
                    alternative: null,
                }));
            } else if (self.condition) {
                body.push(make_node(AST_SimpleStatement, self.condition, { body: self.condition }));
            } else if (retain) {
                body.push(first);
            }
            extract_declarations_from_unreachable_code(compressor, self.body, body);
            return make_node(AST_BlockStatement, self, { body: body });
        }
        if (first instanceof AST_If) {
            var ab = first_statement(first.body);
            if (ab instanceof AST_Break && !external_target(ab)) {
                if (self.condition) {
                    self.condition = make_node(AST_Binary, self.condition, {
                        left: self.condition,
                        operator: "&&",
                        right: first.condition.negate(compressor),
                    });
                } else {
                    self.condition = first.condition.negate(compressor);
                }
                var body = as_statement_array(first.alternative);
                extract_declarations_from_unreachable_code(compressor, first.body, body);
                return drop_it(body);
            }
            ab = first_statement(first.alternative);
            if (ab instanceof AST_Break && !external_target(ab)) {
                if (self.condition) {
                    self.condition = make_node(AST_Binary, self.condition, {
                        left: self.condition,
                        operator: "&&",
                        right: first.condition,
                    });
                } else {
                    self.condition = first.condition;
                }
                var body = as_statement_array(first.body);
                extract_declarations_from_unreachable_code(compressor, first.alternative, body);
                return drop_it(body);
            }
        }
        return self;

        function first_statement(body) {
            return body instanceof AST_BlockStatement ? body.body[0] : body;
        }

        function external_target(node) {
            return compressor.loopcontrol_target(node) !== compressor.self();
        }

        function drop_it(rest) {
            if (self.body instanceof AST_BlockStatement) {
                self.body = self.body.clone();
                self.body.body = rest.concat(self.body.body.slice(1));
                self.body = self.body.transform(compressor);
            } else {
                self.body = make_node(AST_BlockStatement, self.body, { body: rest }).transform(compressor);
            }
            return if_break_in_loop(self, compressor);
        }
    }

    OPT(AST_For, function(self, compressor) {
        if (!compressor.option("loops")) return self;
        if (compressor.option("side_effects")) {
            if (self.init) self.init = self.init.drop_side_effect_free(compressor);
            if (self.step) self.step = self.step.drop_side_effect_free(compressor);
        }
        if (self.condition) {
            var cond = fuzzy_eval(compressor, self.condition);
            if (!cond) {
                if (compressor.option("dead_code")) {
                    var body = [];
                    if (is_statement(self.init)) {
                        body.push(self.init);
                    } else if (self.init) {
                        body.push(make_node(AST_SimpleStatement, self.init, { body: self.init }));
                    }
                    body.push(make_node(AST_SimpleStatement, self.condition, { body: self.condition }));
                    extract_declarations_from_unreachable_code(compressor, self.body, body);
                    return make_node(AST_BlockStatement, self, { body: body }).optimize(compressor);
                }
            } else if (!(cond instanceof AST_Node)) {
                self.body = make_node(AST_BlockStatement, self.body, {
                    body: [
                        make_node(AST_SimpleStatement, self.condition, { body: self.condition }),
                        self.body,
                    ],
                });
                self.condition = null;
            }
        }
        return if_break_in_loop(self, compressor);
    });

    OPT(AST_ForEnumeration, function(self, compressor) {
        if (compressor.option("varify") && is_lexical_definition(self.init)) {
            var name = self.init.definitions[0].name;
            if ((name instanceof AST_Destructured || name instanceof AST_SymbolLet)
                && !name.match_symbol(function(node) {
                    if (node instanceof AST_SymbolDeclaration) {
                        var def = node.definition();
                        return !same_scope(def) || may_overlap(compressor, def);
                    }
                }, true)) {
                self.init = to_var(self.init, self.resolve());
            }
        }
        return self;
    });

    function mark_locally_defined(condition, consequent, alternative) {
        if (condition instanceof AST_Sequence) condition = condition.tail_node();
        if (!(condition instanceof AST_Binary)) return;
        if (!(condition.left instanceof AST_String)) {
            switch (condition.operator) {
              case "&&":
                mark_locally_defined(condition.left, consequent);
                mark_locally_defined(condition.right, consequent);
                break;
              case "||":
                mark_locally_defined(negate(condition.left), alternative);
                mark_locally_defined(negate(condition.right), alternative);
                break;
            }
            return;
        }
        if (!(condition.right instanceof AST_UnaryPrefix)) return;
        if (condition.right.operator != "typeof") return;
        var sym = condition.right.expression;
        if (!is_undeclared_ref(sym)) return;
        var body;
        var undef = condition.left.value == "undefined";
        switch (condition.operator) {
          case "==":
            body = undef ? alternative : consequent;
            break;
          case "!=":
            body = undef ? consequent : alternative;
            break;
          default:
            return;
        }
        if (!body) return;
        var abort = false;
        var def = sym.definition();
        var fn;
        var refs = [];
        var scanned = [];
        var tw = new TreeWalker(function(node, descend) {
            if (abort) return true;
            if (node instanceof AST_Assign) {
                var ref = node.left;
                if (!(ref instanceof AST_SymbolRef && ref.definition() === def)) return;
                node.right.walk(tw);
                switch (node.operator) {
                  case "=":
                  case "&&=":
                    abort = true;
                }
                return true;
            }
            if (node instanceof AST_Call) {
                descend();
                fn = node.expression.tail_node();
                var save;
                if (fn instanceof AST_SymbolRef) {
                    fn = fn.fixed_value();
                    save = refs.length;
                }
                if (!(fn instanceof AST_Lambda)) {
                    abort = true;
                } else if (push_uniq(scanned, fn)) {
                    fn.walk(tw);
                }
                if (save >= 0) refs.length = save;
                return true;
            }
            if (node instanceof AST_DWLoop) {
                var save = refs.length;
                descend();
                if (abort) refs.length = save;
                return true;
            }
            if (node instanceof AST_For) {
                if (node.init) node.init.walk(tw);
                var save = refs.length;
                if (node.condition) node.condition.walk(tw);
                node.body.walk(tw);
                if (node.step) node.step.walk(tw);
                if (abort) refs.length = save;
                return true;
            }
            if (node instanceof AST_ForEnumeration) {
                node.object.walk(tw);
                var save = refs.length;
                node.init.walk(tw);
                node.body.walk(tw);
                if (abort) refs.length = save;
                return true;
            }
            if (node instanceof AST_Scope) {
                if (node === fn) return;
                return true;
            }
            if (node instanceof AST_SymbolRef) {
                if (node.definition() === def) refs.push(node);
                return true;
            }
        });
        body.walk(tw);
        refs.forEach(function(ref) {
            ref.defined = true;
        });

        function negate(node) {
            if (!(node instanceof AST_Binary)) return;
            switch (node.operator) {
              case "==":
                node = node.clone();
                node.operator = "!=";
                return node;
              case "!=":
                node = node.clone();
                node.operator = "==";
                return node;
            }
        }
    }

    function fuzzy_eval(compressor, node, nullish) {
        if (node.truthy) return true;
        if (is_undefined(node)) return undefined;
        if (node.falsy && !nullish) return false;
        if (node.is_truthy()) return true;
        return node.evaluate(compressor, true);
    }

    function mark_duplicate_condition(compressor, node) {
        var child;
        var level = 0;
        var negated = false;
        var parent = compressor.self();
        if (!is_statement(parent)) while (true) {
            child = parent;
            parent = compressor.parent(level++);
            if (parent instanceof AST_Binary) {
                switch (child) {
                  case parent.left:
                    if (lazy_op[parent.operator]) continue;
                    break;
                  case parent.right:
                    if (match(parent.left)) switch (parent.operator) {
                      case "&&":
                        node[negated ? "falsy" : "truthy"] = true;
                        break;
                      case "||":
                      case "??":
                        node[negated ? "truthy" : "falsy"] = true;
                        break;
                    }
                    break;
                }
            } else if (parent instanceof AST_Conditional) {
                var cond = parent.condition;
                if (cond === child) continue;
                if (match(cond)) switch (child) {
                  case parent.consequent:
                    node[negated ? "falsy" : "truthy"] = true;
                    break;
                  case parent.alternative:
                    node[negated ? "truthy" : "falsy"] = true;
                    break;
                }
            } else if (parent instanceof AST_Exit) {
                break;
            } else if (parent instanceof AST_If) {
                break;
            } else if (parent instanceof AST_Sequence) {
                if (parent.expressions[0] === child) continue;
            } else if (parent instanceof AST_SimpleStatement) {
                break;
            }
            return;
        }
        while (true) {
            child = parent;
            parent = compressor.parent(level++);
            if (parent instanceof AST_BlockStatement) {
                if (parent.body[0] === child) continue;
            } else if (parent instanceof AST_If) {
                if (match(parent.condition)) switch (child) {
                  case parent.body:
                    node[negated ? "falsy" : "truthy"] = true;
                    break;
                  case parent.alternative:
                    node[negated ? "truthy" : "falsy"] = true;
                    break;
                }
            }
            return;
        }

        function match(cond) {
            if (node.equals(cond)) return true;
            if (!(cond instanceof AST_UnaryPrefix)) return false;
            if (cond.operator != "!") return false;
            if (!node.equals(cond.expression)) return false;
            negated = true;
            return true;
        }
    }

    OPT(AST_If, function(self, compressor) {
        if (is_empty(self.alternative)) self.alternative = null;

        if (!compressor.option("conditionals")) return self;
        if (compressor.option("booleans") && !self.condition.has_side_effects(compressor)) {
            mark_duplicate_condition(compressor, self.condition);
        }
        // if condition can be statically determined, warn and drop
        // one of the blocks.  note, statically determined implies
        // “has no side effects”; also it doesn't work for cases like
        // `x && true`, though it probably should.
        if (compressor.option("dead_code")) {
            var cond = fuzzy_eval(compressor, self.condition);
            if (!cond) {
                AST_Node.warn("Condition always false [{start}]", self.condition);
                var body = [
                    make_node(AST_SimpleStatement, self.condition, { body: self.condition }).transform(compressor),
                ];
                extract_declarations_from_unreachable_code(compressor, self.body, body);
                if (self.alternative) body.push(self.alternative);
                return make_node(AST_BlockStatement, self, { body: body }).optimize(compressor);
            } else if (!(cond instanceof AST_Node)) {
                AST_Node.warn("Condition always true [{start}]", self.condition);
                var body = [
                    make_node(AST_SimpleStatement, self.condition, { body: self.condition }).transform(compressor),
                    self.body,
                ];
                if (self.alternative) extract_declarations_from_unreachable_code(compressor, self.alternative, body);
                return make_node(AST_BlockStatement, self, { body: body }).optimize(compressor);
            }
        }
        var negated = self.condition.negate(compressor);
        var self_condition_length = self.condition.print_to_string().length;
        var negated_length = negated.print_to_string().length;
        var negated_is_best = negated_length < self_condition_length;
        if (self.alternative && negated_is_best) {
            negated_is_best = false; // because we already do the switch here.
            // no need to swap values of self_condition_length and negated_length
            // here because they are only used in an equality comparison later on.
            self.condition = negated;
            var tmp = self.body;
            self.body = self.alternative;
            self.alternative = is_empty(tmp) ? null : tmp;
        }
        var body_defuns = [];
        var body_var_defs = [];
        var body_refs = [];
        var body_exprs = sequencesize(self.body, body_defuns, body_var_defs, body_refs);
        var alt_defuns = [];
        var alt_var_defs = [];
        var alt_refs = [];
        var alt_exprs = sequencesize(self.alternative, alt_defuns, alt_var_defs, alt_refs);
        if (body_exprs instanceof AST_BlockStatement || alt_exprs instanceof AST_BlockStatement) {
            var body = [], var_defs = [];
            if (body_exprs) {
                [].push.apply(body, body_defuns);
                [].push.apply(var_defs, body_var_defs);
                if (body_exprs instanceof AST_BlockStatement) {
                    self.body = body_exprs;
                } else if (body_exprs.length == 0) {
                    self.body = make_node(AST_EmptyStatement, self.body);
                } else {
                    self.body = make_node(AST_SimpleStatement, self.body, {
                        body: make_sequence(self.body, body_exprs),
                    });
                }
                body_refs.forEach(process_to_assign);
            }
            if (alt_exprs) {
                [].push.apply(body, alt_defuns);
                [].push.apply(var_defs, alt_var_defs);
                if (alt_exprs instanceof AST_BlockStatement) {
                    self.alternative = alt_exprs;
                } else if (alt_exprs.length == 0) {
                    self.alternative = null;
                } else {
                    self.alternative = make_node(AST_SimpleStatement, self.alternative, {
                        body: make_sequence(self.alternative, alt_exprs),
                    });
                }
                alt_refs.forEach(process_to_assign);
            }
            if (var_defs.length > 0) body.push(make_node(AST_Var, self, { definitions: var_defs }));
            if (body.length > 0) {
                body.push(self.transform(compressor));
                return make_node(AST_BlockStatement, self, { body: body }).optimize(compressor);
            }
        } else if (body_exprs && alt_exprs) {
            var body = body_defuns.concat(alt_defuns);
            if (body_var_defs.length > 0 || alt_var_defs.length > 0) body.push(make_node(AST_Var, self, {
                definitions: body_var_defs.concat(alt_var_defs),
            }));
            if (body_exprs.length == 0) {
                body.push(make_node(AST_SimpleStatement, self.condition, {
                    body: alt_exprs.length > 0 ? make_node(AST_Binary, self, {
                        operator: "||",
                        left: self.condition,
                        right: make_sequence(self.alternative, alt_exprs),
                    }).transform(compressor) : self.condition.clone(),
                }).optimize(compressor));
            } else if (alt_exprs.length == 0) {
                if (self_condition_length === negated_length && !negated_is_best
                    && self.condition instanceof AST_Binary && self.condition.operator == "||") {
                    // although the code length of self.condition and negated are the same,
                    // negated does not require additional surrounding parentheses.
                    // see https://github.com/mishoo/UglifyJS/issues/979
                    negated_is_best = true;
                }
                body.push(make_node(AST_SimpleStatement, self, {
                    body: make_node(AST_Binary, self, {
                        operator: negated_is_best ? "||" : "&&",
                        left: negated_is_best ? negated : self.condition,
                        right: make_sequence(self.body, body_exprs),
                    }).transform(compressor),
                }).optimize(compressor));
            } else {
                body.push(make_node(AST_SimpleStatement, self, {
                    body: make_node(AST_Conditional, self, {
                        condition: self.condition,
                        consequent: make_sequence(self.body, body_exprs),
                        alternative: make_sequence(self.alternative, alt_exprs),
                    }),
                }).optimize(compressor));
            }
            body_refs.forEach(process_to_assign);
            alt_refs.forEach(process_to_assign);
            return make_node(AST_BlockStatement, self, { body: body }).optimize(compressor);
        }
        if (is_empty(self.body)) self = make_node(AST_If, self, {
            condition: negated,
            body: self.alternative,
            alternative: null,
        });
        if (self.alternative instanceof AST_Exit && self.body.TYPE == self.alternative.TYPE) {
            var cons_value = self.body.value;
            var alt_value = self.alternative.value;
            if (!cons_value && !alt_value) return make_node(AST_BlockStatement, self, {
                body: [
                    make_node(AST_SimpleStatement, self, { body: self.condition }),
                    self.body,
                ],
            }).optimize(compressor);
            if (cons_value && alt_value || !keep_return_void()) {
                var exit = make_node(self.body.CTOR, self, {
                    value: make_node(AST_Conditional, self, {
                        condition: self.condition,
                        consequent: cons_value || make_node(AST_Undefined, self.body).transform(compressor),
                        alternative: alt_value || make_node(AST_Undefined, self.alternative).transform(compressor),
                    }),
                });
                if (exit instanceof AST_Return) exit.in_bool = self.body.in_bool || self.alternative.in_bool;
                return exit;
            }
        }
        if (self.body instanceof AST_If && !self.body.alternative && !self.alternative) {
            self = make_node(AST_If, self, {
                condition: make_node(AST_Binary, self.condition, {
                    operator: "&&",
                    left: self.condition,
                    right: self.body.condition,
                }),
                body: self.body.body,
                alternative: null,
            });
        }
        if (aborts(self.body) && self.alternative) {
            var alt = self.alternative;
            self.alternative = null;
            return make_node(AST_BlockStatement, self, { body: [ self, alt ] }).optimize(compressor);
        }
        if (aborts(self.alternative)) {
            var body = self.body;
            self.body = self.alternative;
            self.condition = negated_is_best ? negated : self.condition.negate(compressor);
            self.alternative = null;
            return make_node(AST_BlockStatement, self, { body: [ self, body ] }).optimize(compressor);
        }
        if (self.alternative) {
            var body_stats = as_array(self.body);
            var body_index = last_index(body_stats);
            var alt_stats = as_array(self.alternative);
            var alt_index = last_index(alt_stats);
            for (var stats = []; body_index >= 0 && alt_index >= 0;) {
                var stat = body_stats[body_index];
                var alt_stat = alt_stats[alt_index];
                if (stat.equals(alt_stat)) {
                    body_stats.splice(body_index--, 1);
                    alt_stats.splice(alt_index--, 1);
                    stats.unshift(merge_expression(stat, alt_stat));
                } else {
                    if (!(stat instanceof AST_SimpleStatement)) break;
                    if (!(alt_stat instanceof AST_SimpleStatement)) break;
                    var expr1 = stat.body.tail_node();
                    var expr2 = alt_stat.body.tail_node();
                    if (!expr1.equals(expr2)) break;
                    body_index = pop_expr(body_stats, stat.body, body_index);
                    alt_index = pop_expr(alt_stats, alt_stat.body, alt_index);
                    stats.unshift(make_node(AST_SimpleStatement, expr1, { body: merge_expression(expr1, expr2) }));
                }
            }
            if (stats.length > 0) {
                self.body = body_stats.length > 0 ? make_node(AST_BlockStatement, self, {
                    body: body_stats,
                }) : make_node(AST_EmptyStatement, self);
                self.alternative = alt_stats.length > 0 ? make_node(AST_BlockStatement, self, {
                    body: alt_stats,
                }) : null;
                stats.unshift(self);
                return make_node(AST_BlockStatement, self, { body: stats }).optimize(compressor);
            }
        }
        if (compressor.option("typeofs")) mark_locally_defined(self.condition, self.body, self.alternative);
        return self;

        function as_array(node) {
            return node instanceof AST_BlockStatement ? node.body : [ node ];
        }

        function keep_return_void() {
            var has_finally = false, level = 0, node = compressor.self();
            do {
                if (node instanceof AST_Catch) {
                    if (compressor.parent(level).bfinally) has_finally = true;
                    level++;
                } else if (node instanceof AST_Finally) {
                    level++;
                } else if (node instanceof AST_Scope) {
                    return has_finally && in_async_generator(node);
                } else if (node instanceof AST_Try) {
                    if (node.bfinally) has_finally = true;
                }
            } while (node = compressor.parent(level++));
        }

        function last_index(stats) {
            for (var index = stats.length; --index >= 0;) {
                if (!is_declaration(stats[index], true)) break;
            }
            return index;
        }

        function pop_expr(stats, body, index) {
            if (body instanceof AST_Sequence) {
                stats[index] = make_node(AST_SimpleStatement, body, {
                    body: make_sequence(body, body.expressions.slice(0, -1)),
                });
            } else {
                stats.splice(index--, 1);
            }
            return index;
        }

        function sequencesize(stat, defuns, var_defs, refs) {
            if (stat == null) return [];
            if (stat instanceof AST_BlockStatement) {
                var exprs = [];
                for (var i = 0; i < stat.body.length; i++) {
                    var line = stat.body[i];
                    if (line instanceof AST_EmptyStatement) continue;
                    if (line instanceof AST_Exit) {
                        if (i == 0) return;
                        if (exprs.length > 0) {
                            line = line.clone();
                            exprs.push(line.value || make_node(AST_Undefined, line).transform(compressor));
                            line.value = make_sequence(stat, exprs);
                        }
                        var block = stat.clone();
                        block.body = block.body.slice(i + 1);
                        block.body.unshift(line);
                        return block;
                    }
                    if (line instanceof AST_LambdaDefinition) {
                        defuns.push(line);
                    } else if (line instanceof AST_SimpleStatement) {
                        if (!compressor.option("sequences") && exprs.length > 0) return;
                        exprs.push(line.body);
                    } else if (line instanceof AST_Var) {
                        if (!compressor.option("sequences") && exprs.length > 0) return;
                        line.remove_initializers(compressor, var_defs);
                        line.definitions.forEach(process_var_def);
                    } else {
                        return;
                    }
                }
                return exprs;
            }
            if (stat instanceof AST_LambdaDefinition) {
                defuns.push(stat);
                return [];
            }
            if (stat instanceof AST_EmptyStatement) return [];
            if (stat instanceof AST_SimpleStatement) return [ stat.body ];
            if (stat instanceof AST_Var) {
                var exprs = [];
                stat.remove_initializers(compressor, var_defs);
                stat.definitions.forEach(process_var_def);
                return exprs;
            }

            function process_var_def(var_def) {
                if (!var_def.value) return;
                exprs.push(make_node(AST_Assign, var_def, {
                    operator: "=",
                    left: var_def.name.convert_symbol(AST_SymbolRef, function(ref) {
                        refs.push(ref);
                    }),
                    right: var_def.value,
                }));
            }
        }
    });

    OPT(AST_Switch, function(self, compressor) {
        if (!compressor.option("switches")) return self;
        if (!compressor.option("dead_code")) return self;
        var body = [];
        var branch;
        var decl = [];
        var default_branch;
        var exact_match;
        var side_effects = [];
        for (var i = 0, len = self.body.length; i < len; i++) {
            branch = self.body[i];
            if (branch instanceof AST_Default) {
                var prev = body[body.length - 1];
                if (default_branch || is_break(branch.body[0], compressor) && (!prev || aborts(prev))) {
                    eliminate_branch(branch, prev);
                    continue;
                } else {
                    default_branch = branch;
                }
            } else {
                var exp = branch.expression;
                var equals = make_node(AST_Binary, self, {
                    operator: "===",
                    left: self.expression,
                    right: exp,
                }).evaluate(compressor, true);
                if (!equals) {
                    if (exp.has_side_effects(compressor)) side_effects.push(exp);
                    eliminate_branch(branch, body[body.length - 1]);
                    continue;
                }
                if (!(equals instanceof AST_Node)) {
                    if (default_branch) {
                        var default_index = body.indexOf(default_branch);
                        body.splice(default_index, 1);
                        eliminate_branch(default_branch, body[default_index - 1]);
                        default_branch = null;
                    }
                    if (exp.has_side_effects(compressor)) {
                        exact_match = branch;
                    } else {
                        default_branch = branch = make_node(AST_Default, branch);
                    }
                    while (++i < len) eliminate_branch(self.body[i], branch);
                }
            }
            if (i + 1 >= len || aborts(branch)) {
                var prev = body[body.length - 1];
                var statements = branch.body;
                if (aborts(prev)) switch (prev.body.length - statements.length) {
                  case 1:
                    var stat = prev.body[prev.body.length - 1];
                    if (!is_break(stat, compressor)) break;
                    statements = statements.concat(stat);
                  case 0:
                    var prev_block = make_node(AST_BlockStatement, prev);
                    var next_block = make_node(AST_BlockStatement, branch, { body: statements });
                    if (prev_block.equals(next_block)) prev.body = [];
                }
            }
            if (side_effects.length) {
                if (branch instanceof AST_Default) {
                    body.push(make_node(AST_Case, self, { expression: make_sequence(self, side_effects), body: [] }));
                } else {
                    side_effects.push(branch.expression);
                    branch.expression = make_sequence(self, side_effects);
                }
                side_effects = [];
            }
            body.push(branch);
        }
        if (side_effects.length && !exact_match) {
            body.push(make_node(AST_Case, self, { expression: make_sequence(self, side_effects), body: [] }));
        }
        while (branch = body[body.length - 1]) {
            var stat = branch.body[branch.body.length - 1];
            if (is_break(stat, compressor)) branch.body.pop();
            if (branch === default_branch) {
                if (!has_declarations_only(branch)) break;
            } else if (branch.expression.has_side_effects(compressor)) {
                break;
            } else if (default_branch) {
                if (!has_declarations_only(default_branch)) break;
                if (body[body.length - 2] !== default_branch) break;
                default_branch.body = default_branch.body.concat(branch.body);
                branch.body = [];
            } else if (!has_declarations_only(branch)) break;
            eliminate_branch(branch);
            if (body.pop() === default_branch) default_branch = null;
        }
        if (!branch) {
            decl.push(make_node(AST_SimpleStatement, self.expression, { body: self.expression }));
            if (side_effects.length) decl.push(make_node(AST_SimpleStatement, self, {
                body: make_sequence(self, side_effects),
            }));
            return make_node(AST_BlockStatement, self, { body: decl }).optimize(compressor);
        }
        if (branch === default_branch) while (branch = body[body.length - 2]) {
            if (branch instanceof AST_Default) break;
            if (!has_declarations_only(branch)) break;
            var exp = branch.expression;
            if (exp.has_side_effects(compressor)) {
                var prev = body[body.length - 3];
                if (prev && !aborts(prev)) break;
                default_branch.body.unshift(make_node(AST_SimpleStatement, self, { body: exp }));
            }
            eliminate_branch(branch);
            body.splice(-2, 1);
        }
        body[0].body = decl.concat(body[0].body);
        self.body = body;
        if (compressor.option("conditionals")) switch (body.length) {
          case 1:
            if (!no_break(body[0])) break;
            var exp = body[0].expression;
            var statements = body[0].body.slice();
            if (body[0] !== default_branch && body[0] !== exact_match) return make_node(AST_If, self, {
                condition: make_node(AST_Binary, self, {
                    operator: "===",
                    left: self.expression,
                    right: exp,
                }),
                body: make_node(AST_BlockStatement, self, { body: statements }),
                alternative: null,
            }).optimize(compressor);
            if (exp) statements.unshift(make_node(AST_SimpleStatement, exp, { body: exp }));
            statements.unshift(make_node(AST_SimpleStatement, self.expression, { body: self.expression }));
            return make_node(AST_BlockStatement, self, { body: statements }).optimize(compressor);
          case 2:
            if (!member(default_branch, body) || !no_break(body[1])) break;
            var statements = body[0].body.slice();
            var exclusive = statements.length && is_break(statements[statements.length - 1], compressor);
            if (exclusive) statements.pop();
            if (!all(statements, no_break)) break;
            var alternative = body[1].body.length && make_node(AST_BlockStatement, body[1]);
            var node = make_node(AST_If, self, {
                condition: make_node(AST_Binary, self, body[0] === default_branch ? {
                    operator: "!==",
                    left: self.expression,
                    right: body[1].expression,
                } : {
                    operator: "===",
                    left: self.expression,
                    right: body[0].expression,
                }),
                body: make_node(AST_BlockStatement, body[0], { body: statements }),
                alternative: exclusive && alternative || null,
            });
            if (!exclusive && alternative) node = make_node(AST_BlockStatement, self, { body: [ node, alternative ] });
            return node.optimize(compressor);
        }
        return self;

        function is_break(node, tw) {
            return node instanceof AST_Break && tw.loopcontrol_target(node) === self;
        }

        function no_break(node) {
            var found = false;
            var tw = new TreeWalker(function(node) {
                if (found
                    || node instanceof AST_Lambda
                    || node instanceof AST_SimpleStatement) return true;
                if (is_break(node, tw)) found = true;
            });
            tw.push(self);
            node.walk(tw);
            return !found;
        }

        function eliminate_branch(branch, prev) {
            if (prev && !aborts(prev)) {
                prev.body = prev.body.concat(branch.body);
            } else {
                extract_declarations_from_unreachable_code(compressor, branch, decl);
            }
        }
    });

    OPT(AST_Try, function(self, compressor) {
        self.body = tighten_body(self.body, compressor);
        if (compressor.option("dead_code")) {
            if (has_declarations_only(self)
                && !(self.bcatch && self.bcatch.argname && self.bcatch.argname.match_symbol(function(node) {
                    return node instanceof AST_SymbolCatch && !can_drop_symbol(node);
                }, true))) {
                var body = [];
                if (self.bcatch) {
                    extract_declarations_from_unreachable_code(compressor, self.bcatch, body);
                    body.forEach(function(stat) {
                        if (!(stat instanceof AST_Var)) return;
                        stat.definitions.forEach(function(var_def) {
                            var def = var_def.name.definition().redefined();
                            if (!def) return;
                            var_def.name = var_def.name.clone();
                            var_def.name.thedef = def;
                        });
                    });
                }
                body.unshift(make_node(AST_BlockStatement, self).optimize(compressor));
                if (self.bfinally) {
                    body.push(make_node(AST_BlockStatement, self.bfinally).optimize(compressor));
                }
                return make_node(AST_BlockStatement, self, { body: body }).optimize(compressor);
            }
            if (self.bfinally && has_declarations_only(self.bfinally)) {
                var body = make_node(AST_BlockStatement, self.bfinally).optimize(compressor);
                body = self.body.concat(body);
                if (!self.bcatch) return make_node(AST_BlockStatement, self, { body: body }).optimize(compressor);
                self.body = body;
                self.bfinally = null;
            }
        }
        return self;
    });

    function remove_initializers(make_value) {
        return function(compressor, defns) {
            var dropped = false;
            this.definitions.forEach(function(defn) {
                if (defn.value) dropped = true;
                defn.name.match_symbol(function(node) {
                    if (node instanceof AST_SymbolDeclaration) defns.push(make_node(AST_VarDef, node, {
                        name: node,
                        value: make_value(compressor, node),
                    }));
                }, true);
            });
            return dropped;
        };
    }

    AST_Const.DEFMETHOD("remove_initializers", remove_initializers(function(compressor, node) {
        return make_node(AST_Undefined, node).optimize(compressor);
    }));
    AST_Let.DEFMETHOD("remove_initializers", remove_initializers(return_null));
    AST_Var.DEFMETHOD("remove_initializers", remove_initializers(return_null));

    AST_Definitions.DEFMETHOD("to_assignments", function() {
        var assignments = this.definitions.reduce(function(a, defn) {
            var def = defn.name.definition();
            var value = defn.value;
            if (value) {
                if (value instanceof AST_Sequence) value = value.clone();
                var name = make_node(AST_SymbolRef, defn.name);
                var assign = make_node(AST_Assign, defn, {
                    operator: "=",
                    left: name,
                    right: value,
                });
                a.push(assign);
                var fixed = function() {
                    return assign.right;
                };
                fixed.assigns = [ assign ];
                fixed.direct_access = def.direct_access;
                fixed.escaped = def.escaped;
                name.fixed = fixed;
                def.references.forEach(function(ref) {
                    if (!ref.fixed) return;
                    var assigns = ref.fixed.assigns;
                    if (!assigns) return;
                    if (assigns[0] !== defn) return;
                    if (assigns.length > 1 || ref.fixed.to_binary || ref.fixed.to_prefix) {
                        assigns[0] = assign;
                    } else {
                        ref.fixed = fixed;
                        if (def.fixed === ref.fixed) def.fixed = fixed;
                    }
                });
                def.references.push(name);
            }
            def.assignments++;
            def.eliminated++;
            def.single_use = false;
            return a;
        }, []);
        if (assignments.length == 0) return null;
        return make_sequence(this, assignments);
    });

    function is_safe_lexical(def) {
        return def.name != "arguments" && def.orig.length < (def.orig[0] instanceof AST_SymbolLambda ? 3 : 2);
    }

    function may_overlap(compressor, def) {
        if (compressor.exposed(def)) return true;
        var scope = def.scope.resolve();
        for (var s = def.scope; s !== scope;) {
            s = s.parent_scope;
            if (s.var_names().has(def.name)) return true;
        }
    }

    function to_var(stat, scope) {
        return make_node(AST_Var, stat, {
            definitions: stat.definitions.map(function(defn) {
                return make_node(AST_VarDef, defn, {
                    name: defn.name.convert_symbol(AST_SymbolVar, function(name, node) {
                        var def = name.definition();
                        def.orig[def.orig.indexOf(node)] = name;
                        if (def.scope === scope) return;
                        def.scope = scope;
                        scope.variables.set(def.name, def);
                        scope.enclosed.push(def);
                        scope.var_names().set(def.name, true);
                    }),
                    value: defn.value,
                });
            }),
        });
    }

    function can_varify(compressor, sym) {
        var def = sym.definition();
        return (def.fixed || def.fixed === 0)
            && is_safe_lexical(def)
            && same_scope(def)
            && !may_overlap(compressor, def);
    }

    function varify(self, compressor) {
        return compressor.option("varify") && all(self.definitions, function(defn) {
            return !defn.name.match_symbol(function(node) {
                if (node instanceof AST_SymbolDeclaration) return !can_varify(compressor, node);
            }, true);
        }) ? to_var(self, compressor.find_parent(AST_Scope)) : self;
    }

    OPT(AST_Const, varify);
    OPT(AST_Let, varify);

    function trim_optional_chain(node, compressor) {
        if (!compressor.option("optional_chains")) return;
        if (node.terminal) do {
            var expr = node.expression;
            if (node.optional) {
                var ev = fuzzy_eval(compressor, expr, true);
                if (ev == null) return make_node(AST_UnaryPrefix, node, {
                    operator: "void",
                    expression: expr,
                }).optimize(compressor);
                if (!(ev instanceof AST_Node)) node.optional = false;
            }
            node = expr;
        } while ((node.TYPE == "Call" || node instanceof AST_PropAccess) && !node.terminal);
    }

    function lift_sequence_in_expression(node, compressor) {
        var exp = node.expression;
        if (!(exp instanceof AST_Sequence)) return node;
        var x = exp.expressions.slice();
        var e = node.clone();
        e.expression = x.pop();
        x.push(e);
        return make_sequence(node, x);
    }

    function drop_unused_call_args(call, compressor, fns_with_marked_args) {
        var exp = call.expression;
        var fn = exp instanceof AST_SymbolRef ? exp.fixed_value() : exp;
        if (!(fn instanceof AST_Lambda)) return;
        if (fn.uses_arguments) return;
        if (fn.pinned()) return;
        if (fns_with_marked_args && fns_with_marked_args.indexOf(fn) < 0) return;
        var args = call.args;
        if (!all(args, function(arg) {
            return !(arg instanceof AST_Spread);
        })) return;
        var argnames = fn.argnames;
        var is_iife = fn === exp && !fn.name;
        if (fn.rest) {
            if (!(is_iife && compressor.option("rests"))) return;
            var insert = argnames.length;
            args = args.slice(0, insert);
            while (args.length < insert) args.push(make_node(AST_Undefined, call).optimize(compressor));
            args.push(make_node(AST_Array, call, { elements: call.args.slice(insert) }));
            argnames = argnames.concat(fn.rest);
            fn.rest = null;
        } else {
            args = args.slice();
            argnames = argnames.slice();
        }
        var pos = 0, last = 0;
        var drop_defaults = is_iife && compressor.option("default_values");
        var drop_fargs = is_iife && compressor.drop_fargs(fn, call) ? function(argname, arg) {
            if (!argname) return true;
            if (argname instanceof AST_DestructuredArray) {
                return argname.elements.length == 0 && !argname.rest && arg instanceof AST_Array;
            }
            if (argname instanceof AST_DestructuredObject) {
                return argname.properties.length == 0 && !argname.rest && arg && !arg.may_throw_on_access(compressor);
            }
            return argname.unused;
        } : return_false;
        var side_effects = [];
        for (var i = 0; i < args.length; i++) {
            var argname = argnames[i];
            if (drop_defaults && argname instanceof AST_DefaultValue && args[i].is_defined(compressor)) {
                argnames[i] = argname = argname.name;
            }
            if (!argname || argname.unused !== undefined) {
                var node = args[i].drop_side_effect_free(compressor);
                if (drop_fargs(argname)) {
                    if (argname) argnames.splice(i, 1);
                    args.splice(i, 1);
                    if (node) side_effects.push(node);
                    i--;
                    continue;
                } else if (node) {
                    side_effects.push(node);
                    args[pos++] = make_sequence(call, side_effects);
                    side_effects = [];
                } else if (argname) {
                    if (side_effects.length) {
                        args[pos++] = make_sequence(call, side_effects);
                        side_effects = [];
                    } else {
                        args[pos++] = make_node(AST_Number, args[i], { value: 0 });
                        continue;
                    }
                }
            } else if (drop_fargs(argname, args[i])) {
                var node = args[i].drop_side_effect_free(compressor);
                argnames.splice(i, 1);
                args.splice(i, 1);
                if (node) side_effects.push(node);
                i--;
                continue;
            } else {
                side_effects.push(args[i]);
                args[pos++] = make_sequence(call, side_effects);
                side_effects = [];
            }
            last = pos;
        }
        for (; i < argnames.length; i++) {
            if (drop_fargs(argnames[i])) argnames.splice(i--, 1);
        }
        fn.argnames = argnames;
        args.length = last;
        call.args = args;
        if (!side_effects.length) return;
        var arg = make_sequence(call, side_effects);
        args.push(args.length < argnames.length ? make_node(AST_UnaryPrefix, call, {
            operator: "void",
            expression: arg,
        }) : arg);
    }

    function avoid_await_yield(compressor, parent_scope) {
        if (!parent_scope) parent_scope = compressor.find_parent(AST_Scope);
        var avoid = [];
        if (is_async(parent_scope) || parent_scope instanceof AST_Toplevel && compressor.option("module")) {
            avoid.push("await");
        }
        if (is_generator(parent_scope)) avoid.push("yield");
        return avoid.length && makePredicate(avoid);
    }

    function safe_from_await_yield(fn, avoid) {
        if (!avoid) return true;
        var safe = true;
        var tw = new TreeWalker(function(node) {
            if (!safe) return true;
            if (node instanceof AST_Scope) {
                if (node === fn) return;
                if (is_arrow(node)) {
                    for (var i = 0; safe && i < node.argnames.length; i++) node.argnames[i].walk(tw);
                } else if (node instanceof AST_LambdaDefinition && avoid[node.name.name]) {
                    safe = false;
                }
                return true;
            }
            if (node instanceof AST_Symbol && avoid[node.name] && node !== fn.name) safe = false;
        });
        fn.walk(tw);
        return safe;
    }

    function safe_from_strict_mode(fn, compressor) {
        return fn.in_strict_mode(compressor) || !compressor.has_directive("use strict");
    }

    OPT(AST_Call, function(self, compressor) {
        var exp = self.expression;
        var terminated = trim_optional_chain(self, compressor);
        if (terminated) return terminated;
        if (compressor.option("sequences")) {
            if (exp instanceof AST_PropAccess) {
                var seq = lift_sequence_in_expression(exp, compressor);
                if (seq !== exp) {
                    var call = self.clone();
                    call.expression = seq.expressions.pop();
                    seq.expressions.push(call);
                    return seq.optimize(compressor);
                }
            } else if (!needs_unbinding(exp.tail_node())) {
                var seq = lift_sequence_in_expression(self, compressor);
                if (seq !== self) return seq.optimize(compressor);
            }
        }
        if (compressor.option("unused")) drop_unused_call_args(self, compressor);
        if (compressor.option("unsafe")) {
            if (is_undeclared_ref(exp)) switch (exp.name) {
              case "Array":
                // Array(n) ---> [ , , ... , ]
                if (self.args.length == 1) {
                    var first = self.args[0];
                    if (first instanceof AST_Number) try {
                        var length = first.value;
                        if (length > 6) break;
                        var elements = Array(length);
                        for (var i = 0; i < length; i++) elements[i] = make_node(AST_Hole, self);
                        return make_node(AST_Array, self, { elements: elements });
                    } catch (ex) {
                        AST_Node.warn("Invalid array length: {length} [{start}]", {
                            length: length,
                            start: self.start,
                        });
                        break;
                    }
                    if (!first.is_boolean(compressor) && !first.is_string(compressor)) break;
                }
                // Array(...) ---> [ ... ]
                return make_node(AST_Array, self, { elements: self.args });
              case "Object":
                // Object() ---> {}
                if (self.args.length == 0) return make_node(AST_Object, self, { properties: [] });
                break;
              case "String":
                // String() ---> ""
                if (self.args.length == 0) return make_node(AST_String, self, { value: "" });
                // String(x) ---> "" + x
                if (self.args.length == 1) return make_node(AST_Binary, self, {
                    operator: "+",
                    left: make_node(AST_String, self, { value: "" }),
                    right: self.args[0],
                }).optimize(compressor);
                break;
              case "Number":
                // Number() ---> 0
                if (self.args.length == 0) return make_node(AST_Number, self, { value: 0 });
                // Number(x) ---> +("" + x)
                if (self.args.length == 1) return make_node(AST_UnaryPrefix, self, {
                    operator: "+",
                    expression: make_node(AST_Binary, self, {
                        operator: "+",
                        left: make_node(AST_String, self, { value: "" }),
                        right: self.args[0],
                    }),
                }).optimize(compressor);
                break;
              case "Boolean":
                // Boolean() ---> false
                if (self.args.length == 0) return make_node(AST_False, self).optimize(compressor);
                // Boolean(x) ---> !!x
                if (self.args.length == 1) return make_node(AST_UnaryPrefix, self, {
                    operator: "!",
                    expression: make_node(AST_UnaryPrefix, self, {
                        operator: "!",
                        expression: self.args[0],
                    }),
                }).optimize(compressor);
                break;
              case "RegExp":
                // attempt to convert RegExp(...) to literal
                var params = [];
                if (all(self.args, function(arg) {
                    var value = arg.evaluate(compressor);
                    params.unshift(value);
                    return arg !== value;
                })) try {
                    return best_of(compressor, self, make_node(AST_RegExp, self, {
                        value: RegExp.apply(RegExp, params),
                    }));
                } catch (ex) {
                    AST_Node.warn("Error converting {this} [{start}]", self);
                }
                break;
            } else if (exp instanceof AST_Dot) switch (exp.property) {
              case "toString":
                // x.toString() ---> "" + x
                var expr = exp.expression;
                if (self.args.length == 0 && !(expr.may_throw_on_access(compressor) || expr instanceof AST_Super)) {
                    return make_node(AST_Binary, self, {
                        operator: "+",
                        left: make_node(AST_String, self, { value: "" }),
                        right: expr,
                    }).optimize(compressor);
                }
                break;
              case "join":
                if (exp.expression instanceof AST_Array && self.args.length < 2) EXIT: {
                    var separator = self.args[0];
                    // [].join() ---> ""
                    // [].join(x) ---> (x, "")
                    if (exp.expression.elements.length == 0 && !(separator instanceof AST_Spread)) {
                        return separator ? make_sequence(self, [
                            separator,
                            make_node(AST_String, self, { value: "" }),
                        ]).optimize(compressor) : make_node(AST_String, self, { value: "" });
                    }
                    if (separator) {
                        separator = separator.evaluate(compressor);
                        if (separator instanceof AST_Node) break EXIT; // not a constant
                    }
                    var elements = [];
                    var consts = [];
                    for (var i = 0; i < exp.expression.elements.length; i++) {
                        var el = exp.expression.elements[i];
                        var value = el.evaluate(compressor);
                        if (value !== el) {
                            consts.push(value);
                        } else if (el instanceof AST_Spread) {
                            break EXIT;
                        } else {
                            if (consts.length > 0) {
                                elements.push(make_node(AST_String, self, { value: consts.join(separator) }));
                                consts.length = 0;
                            }
                            elements.push(el);
                        }
                    }
                    if (consts.length > 0) elements.push(make_node(AST_String, self, {
                        value: consts.join(separator),
                    }));
                    // [ x ].join() ---> "" + x
                    // [ x ].join(".") ---> "" + x
                    // [ 1, 2, 3 ].join() ---> "1,2,3"
                    // [ 1, 2, 3 ].join(".") ---> "1.2.3"
                    if (elements.length == 1) {
                        if (elements[0].is_string(compressor)) return elements[0];
                        return make_node(AST_Binary, elements[0], {
                            operator: "+",
                            left: make_node(AST_String, self, { value: "" }),
                            right: elements[0],
                        });
                    }
                    // [ 1, 2, a, 3 ].join("") ---> "12" + a + "3"
                    if (separator == "") {
                        var first;
                        if (elements[0].is_string(compressor) || elements[1].is_string(compressor)) {
                            first = elements.shift();
                        } else {
                            first = make_node(AST_String, self, { value: "" });
                        }
                        return elements.reduce(function(prev, el) {
                            return make_node(AST_Binary, el, {
                                operator: "+",
                                left: prev,
                                right: el,
                            });
                        }, first).optimize(compressor);
                    }
                    // [ x, "foo", "bar", y ].join() ---> [ x, "foo,bar", y ].join()
                    // [ x, "foo", "bar", y ].join("-") ---> [ x, "foo-bar", y ].join("-")
                    // need this awkward cloning to not affect original element
                    // best_of will decide which one to get through.
                    var node = self.clone();
                    node.expression = node.expression.clone();
                    node.expression.expression = node.expression.expression.clone();
                    node.expression.expression.elements = elements;
                    return best_of(compressor, self, node);
                }
                break;
              case "charAt":
                if (self.args.length < 2) {
                    var node = make_node(AST_Binary, self, {
                        operator: "||",
                        left: make_node(AST_Sub, self, {
                            expression: exp.expression,
                            property: self.args.length ? make_node(AST_Binary, self.args[0], {
                                operator: "|",
                                left: make_node(AST_Number, self, { value: 0 }),
                                right: self.args[0],
                            }) : make_node(AST_Number, self, { value: 0 }),
                        }).optimize(compressor),
                        right: make_node(AST_String, self, { value: "" }),
                    });
                    node.is_string = return_true;
                    return node.optimize(compressor);
                }
                break;
              case "apply":
                if (self.args.length == 2 && self.args[1] instanceof AST_Array) {
                    var args = self.args[1].elements.slice();
                    args.unshift(self.args[0]);
                    return make_node(AST_Call, self, {
                        expression: make_node(AST_Dot, exp, {
                            expression: exp.expression,
                            property: "call",
                        }),
                        args: args,
                    }).optimize(compressor);
                }
                break;
              case "call":
                var func = exp.expression;
                if (func instanceof AST_SymbolRef) {
                    func = func.fixed_value();
                }
                if (func instanceof AST_Lambda && !func.contains_this()) {
                    return (self.args.length ? make_sequence(self, [
                        self.args[0],
                        make_node(AST_Call, self, {
                            expression: exp.expression,
                            args: self.args.slice(1),
                        }),
                    ]) : make_node(AST_Call, self, {
                        expression: exp.expression,
                        args: [],
                    })).optimize(compressor);
                }
                break;
            } else if (compressor.option("side_effects")
                && exp instanceof AST_Call
                && exp.args.length == 1
                && is_undeclared_ref(exp.expression)
                && exp.expression.name == "Object") {
                var call = self.clone();
                call.expression = maintain_this_binding(self, exp, exp.args[0]);
                return call.optimize(compressor);
            }
        }
        if (compressor.option("unsafe_Function")
            && is_undeclared_ref(exp)
            && exp.name == "Function") {
            // new Function() ---> function(){}
            if (self.args.length == 0) return make_node(AST_Function, self, {
                argnames: [],
                body: [],
            }).init_vars(exp.scope);
            if (all(self.args, function(x) {
                return x instanceof AST_String;
            })) {
                // quite a corner-case, but we can handle it:
                //   https://github.com/mishoo/UglifyJS/issues/203
                // if the code argument is a constant, then we can minify it.
                try {
                    var code = "n(function(" + self.args.slice(0, -1).map(function(arg) {
                        return arg.value;
                    }).join() + "){" + self.args[self.args.length - 1].value + "})";
                    var ast = parse(code);
                    var mangle = { ie: compressor.option("ie") };
                    ast.figure_out_scope(mangle);
                    var comp = new Compressor(compressor.options);
                    ast = ast.transform(comp);
                    ast.figure_out_scope(mangle);
                    ast.compute_char_frequency(mangle);
                    ast.mangle_names(mangle);
                    var fun;
                    ast.walk(new TreeWalker(function(node) {
                        if (fun) return true;
                        if (node instanceof AST_Lambda) {
                            fun = node;
                            return true;
                        }
                    }));
                    var code = OutputStream();
                    AST_BlockStatement.prototype._codegen.call(fun, code);
                    self.args = [
                        make_node(AST_String, self, {
                            value: fun.argnames.map(function(arg) {
                                return arg.print_to_string();
                            }).join(),
                        }),
                        make_node(AST_String, self.args[self.args.length - 1], {
                            value: code.get().replace(/^\{|\}$/g, "")
                        }),
                    ];
                    return self;
                } catch (ex) {
                    if (ex instanceof JS_Parse_Error) {
                        AST_Node.warn("Error parsing code passed to new Function [{start}]", self.args[self.args.length - 1]);
                        AST_Node.warn(ex.toString());
                    } else {
                        throw ex;
                    }
                }
            }
        }
        var fn = exp instanceof AST_SymbolRef ? exp.fixed_value() : exp;
        var parent = compressor.parent(), current = compressor.self();
        var is_func = fn instanceof AST_Lambda
            && (!is_async(fn) || compressor.option("awaits") && parent instanceof AST_Await)
            && (!is_generator(fn) || compressor.option("yields") && current instanceof AST_Yield && current.nested);
        var stat = is_func && fn.first_statement();
        var has_default = 0, has_destructured = false;
        var has_spread = !all(self.args, function(arg) {
            return !(arg instanceof AST_Spread);
        });
        var can_drop = is_func && all(fn.argnames, function(argname, index) {
            if (has_default == 1 && self.args[index] instanceof AST_Spread) has_default = 2;
            if (argname instanceof AST_DefaultValue) {
                if (!has_default) has_default = 1;
                var arg = has_default == 1 && self.args[index];
                if (!is_undefined(arg)) has_default = 2;
                if (has_arg_refs(fn, argname.value)) return false;
                argname = argname.name;
            }
            if (argname instanceof AST_Destructured) {
                has_destructured = true;
                if (has_arg_refs(fn, argname)) return false;
            }
            return true;
        }) && !(fn.rest instanceof AST_Destructured && has_arg_refs(fn, fn.rest));
        var can_inline = can_drop
            && compressor.option("inline")
            && !self.is_expr_pure(compressor)
            && (exp === fn || safe_from_strict_mode(fn, compressor));
        if (can_inline && stat instanceof AST_Return) {
            var value = stat.value;
            if (exp === fn
                && !fn.name
                && (!value || value.is_constant_expression())
                && safe_from_await_yield(fn, avoid_await_yield(compressor))) {
                return make_sequence(self, convert_args(value)).optimize(compressor);
            }
        }
        if (is_func && !fn.contains_this()) {
            var def, value, var_assigned = false;
            if (can_inline
                && !fn.uses_arguments
                && !fn.pinned()
                && !(fn.name && fn instanceof AST_LambdaExpression)
                && (exp === fn || !recursive_ref(compressor, def = exp.definition(), fn)
                    && fn.is_constant_expression(find_scope(compressor)))
                && (value = can_flatten_body(stat))) {
                var replacing = exp === fn || def.single_use && def.references.length - def.replaced == 1;
                if (can_substitute_directly()) {
                    var args = self.args.slice();
                    var refs = [];
                    var retValue = value.clone(true).transform(new TreeTransformer(function(node) {
                        if (node instanceof AST_SymbolRef) {
                            var def = node.definition();
                            if (fn.variables.get(node.name) !== def) {
                                refs.push(node);
                                return node;
                            }
                            var index = resolve_index(def);
                            var arg = args[index];
                            if (!arg) return make_node(AST_Undefined, self);
                            args[index] = null;
                            var parent = this.parent();
                            return parent ? maintain_this_binding(parent, node, arg) : arg;
                        }
                    }));
                    var save_inlined = fn.inlined;
                    if (exp !== fn) fn.inlined = true;
                    var exprs = [];
                    args.forEach(function(arg) {
                        if (!arg) return;
                        arg = arg.clone(true);
                        arg.walk(new TreeWalker(function(node) {
                            if (node instanceof AST_SymbolRef) refs.push(node);
                        }));
                        exprs.push(arg);
                    }, []);
                    exprs.push(retValue);
                    var node = make_sequence(self, exprs).optimize(compressor);
                    fn.inlined = save_inlined;
                    node = maintain_this_binding(parent, current, node);
                    if (replacing || best_of_expression(node, self) === node) {
                        refs.forEach(function(ref) {
                            ref.scope = exp === fn ? fn.parent_scope : exp.scope;
                            ref.reference();
                            var def = ref.definition();
                            if (replacing) def.replaced++;
                            def.single_use = false;
                        });
                        return node;
                    } else if (!node.has_side_effects(compressor)) {
                        self.drop_side_effect_free = function(compressor, first_in_statement) {
                            var self = this;
                            var exprs = self.args.slice();
                            exprs.unshift(self.expression);
                            return make_sequence(self, exprs).drop_side_effect_free(compressor, first_in_statement);
                        };
                    }
                }
                var arg_used, insert, in_loop, scope;
                if (replacing && can_inject_symbols()) {
                    fn._squeezed = true;
                    if (exp !== fn) fn.parent_scope = exp.scope;
                    var node = make_sequence(self, flatten_fn()).optimize(compressor);
                    return maintain_this_binding(parent, current, node);
                }
            }
            if (compressor.option("side_effects")
                && can_drop
                && all(fn.body, is_empty)
                && (fn === exp ? fn_name_unused(fn, compressor) : !has_default && !has_destructured && !fn.rest)
                && !(is_arrow(fn) && fn.value)
                && safe_from_await_yield(fn, avoid_await_yield(compressor))) {
                return make_sequence(self, convert_args()).optimize(compressor);
            }
        }
        if (compressor.option("drop_console")) {
            if (exp instanceof AST_PropAccess) {
                var name = exp.expression;
                while (name.expression) {
                    name = name.expression;
                }
                if (is_undeclared_ref(name) && name.name == "console") {
                    return make_node(AST_Undefined, self).optimize(compressor);
                }
            }
        }
        if (compressor.option("negate_iife") && parent instanceof AST_SimpleStatement && is_iife_call(current)) {
            return self.negate(compressor, true);
        }
        return try_evaluate(compressor, self);

        function make_void_lhs(orig) {
            return make_node(AST_Sub, orig, {
                expression: make_node(AST_Array, orig, { elements: [] }),
                property: make_node(AST_Number, orig, { value: 0 }),
            });
        }

        function convert_args(value) {
            var args = self.args.slice();
            var destructured = has_default > 1 || has_destructured || fn.rest;
            if (destructured || has_spread) args = [ make_node(AST_Array, self, { elements: args }) ];
            if (destructured) {
                var tt = new TreeTransformer(function(node, descend) {
                    if (node instanceof AST_DefaultValue) return make_node(AST_DefaultValue, node, {
                        name: node.name.transform(tt) || make_void_lhs(node),
                        value: node.value,
                    });
                    if (node instanceof AST_DestructuredArray) {
                        var elements = [];
                        node.elements.forEach(function(node, index) {
                            node = node.transform(tt);
                            if (node) elements[index] = node;
                        });
                        fill_holes(node, elements);
                        return make_node(AST_DestructuredArray, node, { elements: elements });
                    }
                    if (node instanceof AST_DestructuredObject) {
                        var properties = [], side_effects = [];
                        node.properties.forEach(function(prop) {
                            var key = prop.key;
                            var value = prop.value.transform(tt);
                            if (value) {
                                if (side_effects.length) {
                                    if (!(key instanceof AST_Node)) key = make_node_from_constant(key, prop);
                                    side_effects.push(key);
                                    key = make_sequence(node, side_effects);
                                    side_effects = [];
                                }
                                properties.push(make_node(AST_DestructuredKeyVal, prop, {
                                    key: key,
                                    value: value,
                                }));
                            } else if (key instanceof AST_Node) {
                                side_effects.push(key);
                            }
                        });
                        if (side_effects.length) properties.push(make_node(AST_DestructuredKeyVal, node, {
                            key: make_sequence(node, side_effects),
                            value: make_void_lhs(node),
                        }));
                        return make_node(AST_DestructuredObject, node, { properties: properties });
                    }
                    if (node instanceof AST_SymbolFunarg) return null;
                });
                var lhs = [];
                fn.argnames.forEach(function(argname, index) {
                    argname = argname.transform(tt);
                    if (argname) lhs[index] = argname;
                });
                var rest = fn.rest && fn.rest.transform(tt);
                if (rest) lhs.length = fn.argnames.length;
                fill_holes(fn, lhs);
                args[0] = make_node(AST_Assign, self, {
                    operator: "=",
                    left: make_node(AST_DestructuredArray, fn, {
                        elements: lhs,
                        rest: rest,
                    }),
                    right: args[0],
                });
            } else fn.argnames.forEach(function(argname) {
                if (argname instanceof AST_DefaultValue) args.push(argname.value);
            });
            args.push(value || make_node(AST_Undefined, self));
            return args;
        }

        function noop_value() {
            return self.call_only ? make_node(AST_Number, self, { value: 0 }) : make_node(AST_Undefined, self);
        }

        function return_value(stat) {
            if (!stat) return noop_value();
            if (stat instanceof AST_Return) return stat.value || noop_value();
            if (stat instanceof AST_SimpleStatement) {
                return self.call_only ? stat.body : make_node(AST_UnaryPrefix, stat, {
                    operator: "void",
                    expression: stat.body,
                });
            }
        }

        function can_flatten_body(stat) {
            var len = fn.body.length;
            if (len < 2) {
                stat = return_value(stat);
                if (stat) return stat;
            }
            if (compressor.option("inline") < 3) return false;
            stat = null;
            for (var i = 0; i < len; i++) {
                var line = fn.body[i];
                if (line instanceof AST_Var) {
                    if (var_assigned) {
                        if (!stat) continue;
                        if (!(stat instanceof AST_SimpleStatement)) return false;
                        if (!declarations_only(line)) stat = null;
                    } else if (!declarations_only(line)) {
                        if (stat && !(stat instanceof AST_SimpleStatement)) return false;
                        stat = null;
                        var_assigned = true;
                    }
                } else if (line instanceof AST_AsyncDefun
                    || line instanceof AST_Defun
                    || line instanceof AST_EmptyStatement) {
                    continue;
                } else if (stat) {
                    return false;
                } else {
                    stat = line;
                }
            }
            return return_value(stat);
        }

        function resolve_index(def) {
            for (var i = fn.argnames.length; --i >= 0;) {
                if (fn.argnames[i].definition() === def) return i;
            }
        }

        function can_substitute_directly() {
            if (has_default || has_destructured || has_spread || var_assigned || fn.rest) return;
            if (compressor.option("inline") < 2 && fn.argnames.length) return;
            if (!fn.variables.all(function(def) {
                return def.references.length - def.replaced < 2 && def.orig[0] instanceof AST_SymbolFunarg;
            })) return;
            var scope = compressor.find_parent(AST_Scope);
            var abort = false;
            var avoid = avoid_await_yield(compressor, scope);
            var begin;
            var in_order = [];
            var side_effects = false;
            var tw = new TreeWalker(function(node, descend) {
                if (abort) return true;
                if (node instanceof AST_Binary && lazy_op[node.operator]
                    || node instanceof AST_Conditional) {
                    in_order = null;
                    return;
                }
                if (node instanceof AST_Scope) return abort = true;
                if (avoid && node instanceof AST_Symbol && avoid[node.name]) return abort = true;
                if (node instanceof AST_SymbolRef) {
                    var def = node.definition();
                    if (fn.variables.get(node.name) !== def) {
                        in_order = null;
                        return;
                    }
                    if (def.init instanceof AST_LambdaDefinition) return abort = true;
                    if (is_lhs(node, tw.parent())) return abort = true;
                    var index = resolve_index(def);
                    if (!(begin < index)) begin = index;
                    if (!in_order) return;
                    if (side_effects) {
                        in_order = null;
                    } else {
                        in_order.push(fn.argnames[index]);
                    }
                    return;
                }
                if (side_effects) return;
                if (node instanceof AST_Assign && node.left instanceof AST_PropAccess) {
                    node.left.expression.walk(tw);
                    if (node.left instanceof AST_Sub) node.left.property.walk(tw);
                    node.right.walk(tw);
                    side_effects = true;
                    return true;
                }
                if (node.has_side_effects(compressor)) {
                    descend();
                    side_effects = true;
                    return true;
                }
            });
            value.walk(tw);
            if (abort) return;
            var end = self.args.length;
            if (in_order && fn.argnames.length >= end) {
                end = fn.argnames.length;
                while (end-- > begin && fn.argnames[end] === in_order.pop());
                end++;
            }
            return end <= begin || all(self.args.slice(begin, end), side_effects && !in_order ? function(funarg) {
                return funarg.is_constant_expression(scope);
            } : function(funarg) {
                return !funarg.has_side_effects(compressor);
            });
        }

        function var_exists(defined, name) {
            return defined.has(name) || identifier_atom[name] || scope.var_names().has(name);
        }

        function can_inject_args(defined, safe_to_inject) {
            var abort = false;
            fn.each_argname(function(arg) {
                if (abort) return;
                if (arg.unused) return;
                if (!safe_to_inject || var_exists(defined, arg.name)) return abort = true;
                arg_used.set(arg.name, true);
                if (in_loop) in_loop.push(arg.definition());
            });
            return !abort;
        }

        function can_inject_vars(defined, safe_to_inject) {
            for (var i = 0; i < fn.body.length; i++) {
                var stat = fn.body[i];
                if (stat instanceof AST_LambdaDefinition) {
                    var name = stat.name;
                    if (!safe_to_inject) return false;
                    if (arg_used.has(name.name)) return false;
                    if (var_exists(defined, name.name)) return false;
                    if (!all(stat.enclosed, function(def) {
                        return def.scope === scope || def.scope === stat || !defined.has(def.name);
                    })) return false;
                    if (in_loop) in_loop.push(name.definition());
                    continue;
                }
                if (!(stat instanceof AST_Var)) continue;
                if (!safe_to_inject) return false;
                for (var j = stat.definitions.length; --j >= 0;) {
                    var name = stat.definitions[j].name;
                    if (var_exists(defined, name.name)) return false;
                    if (in_loop) in_loop.push(name.definition());
                }
            }
            return true;
        }

        function can_inject_symbols() {
            var defined = new Dictionary();
            var level = 0, child;
            scope = current;
            do {
                if (scope.variables) scope.variables.each(function(def) {
                    defined.set(def.name, true);
                });
                child = scope;
                scope = compressor.parent(level++);
                if (scope instanceof AST_ClassField) {
                    if (!scope.static) return false;
                } else if (scope instanceof AST_DWLoop) {
                    in_loop = [];
                } else if (scope instanceof AST_For) {
                    if (scope.init === child) continue;
                    in_loop = [];
                } else if (scope instanceof AST_ForEnumeration) {
                    if (scope.init === child) continue;
                    if (scope.object === child) continue;
                    in_loop = [];
                }
            } while (!(scope instanceof AST_Scope));
            insert = scope.body.indexOf(child) + 1;
            if (!insert) return false;
            if (!safe_from_await_yield(fn, avoid_await_yield(compressor, scope))) return false;
            var safe_to_inject = (exp !== fn || fn.parent_scope.resolve() === scope) && !scope.pinned();
            if (scope instanceof AST_Toplevel) {
                if (compressor.toplevel.vars) {
                    defined.set("arguments", true);
                } else {
                    safe_to_inject = false;
                }
            }
            arg_used = new Dictionary();
            var inline = compressor.option("inline");
            if (!can_inject_args(defined, inline >= 2 && safe_to_inject)) return false;
            if (!can_inject_vars(defined, inline >= 3 && safe_to_inject)) return false;
            return !in_loop || in_loop.length == 0 || !is_reachable(fn, in_loop);
        }

        function append_var(decls, expressions, name, value) {
            var def = name.definition();
            if (!scope.var_names().has(name.name)) {
                scope.var_names().set(name.name, true);
                decls.push(make_node(AST_VarDef, name, {
                    name: name,
                    value: null,
                }));
            }
            scope.variables.set(name.name, def);
            scope.enclosed.push(def);
            if (!value) return;
            var sym = make_node(AST_SymbolRef, name);
            def.assignments++;
            def.references.push(sym);
            expressions.push(make_node(AST_Assign, self, {
                operator: "=",
                left: sym,
                right: value,
            }));
        }

        function flatten_args(decls, expressions) {
            var len = fn.argnames.length;
            for (var i = self.args.length; --i >= len;) {
                expressions.push(self.args[i]);
            }
            var default_args = [];
            for (i = len; --i >= 0;) {
                var argname = fn.argnames[i];
                var name;
                if (argname instanceof AST_DefaultValue) {
                    default_args.push(argname);
                    name = argname.name;
                } else {
                    name = argname;
                }
                var value = self.args[i];
                if (name.unused || scope.var_names().has(name.name)) {
                    if (value) expressions.push(value);
                } else {
                    var symbol = make_node(AST_SymbolVar, name);
                    var def = name.definition();
                    def.orig.push(symbol);
                    def.eliminated++;
                    if (name.unused !== undefined) {
                        append_var(decls, expressions, symbol);
                        if (value) expressions.push(value);
                    } else {
                        if (!value && argname === name && (in_loop
                            || name.name == "arguments" && !is_arrow(fn) && is_arrow(scope))) {
                            value = make_node(AST_Undefined, self);
                        }
                        append_var(decls, expressions, symbol, value);
                    }
                }
            }
            decls.reverse();
            expressions.reverse();
            for (i = default_args.length; --i >= 0;) {
                var node = default_args[i];
                if (node.name.unused !== undefined) {
                    expressions.push(node.value);
                } else {
                    var sym = make_node(AST_SymbolRef, node.name);
                    node.name.definition().references.push(sym);
                    expressions.push(make_node(AST_Assign, node, {
                        operator: "=",
                        left: sym,
                        right: node.value,
                    }));
                }
            }
        }

        function flatten_destructured(decls, expressions) {
            expressions.push(make_node(AST_Assign, self, {
                operator: "=",
                left: make_node(AST_DestructuredArray, self, {
                    elements: fn.argnames.map(function(argname) {
                        if (argname.unused) return make_node(AST_Hole, argname);
                        return argname.convert_symbol(AST_SymbolRef, process);
                    }),
                    rest: fn.rest && fn.rest.convert_symbol(AST_SymbolRef, process),
                }),
                right: make_node(AST_Array, self, { elements: self.args.slice() }),
            }));

            function process(ref, name) {
                if (name.unused) return make_void_lhs(name);
                var def = name.definition();
                def.assignments++;
                def.references.push(ref);
                var symbol = make_node(AST_SymbolVar, name);
                def.orig.push(symbol);
                def.eliminated++;
                append_var(decls, expressions, symbol);
            }
        }

        function flatten_vars(decls, expressions) {
            var args = [ insert, 0 ];
            var decl_var = [], expr_fn = [], expr_var = [], expr_loop = [], exprs = [];
            fn.body.filter(in_loop ? function(stat) {
                if (!(stat instanceof AST_LambdaDefinition)) return true;
                var name = make_node(AST_SymbolVar, flatten_var(stat.name));
                var def = name.definition();
                def.fixed = false;
                def.orig.push(name);
                def.eliminated++;
                append_var(decls, expr_fn, name, to_func_expr(stat, true));
                return false;
            } : function(stat) {
                if (!(stat instanceof AST_LambdaDefinition)) return true;
                var def = stat.name.definition();
                scope.functions.set(def.name, def);
                scope.variables.set(def.name, def);
                scope.enclosed.push(def);
                scope.var_names().set(def.name, true);
                args.push(stat);
                return false;
            }).forEach(function(stat) {
                if (!(stat instanceof AST_Var)) {
                    if (stat instanceof AST_SimpleStatement) exprs.push(stat.body);
                    return;
                }
                for (var j = 0; j < stat.definitions.length; j++) {
                    var var_def = stat.definitions[j];
                    var name = flatten_var(var_def.name);
                    var value = var_def.value;
                    if (value && exprs.length > 0) {
                        exprs.push(value);
                        value = make_sequence(var_def, exprs);
                        exprs = [];
                    }
                    append_var(decl_var, expr_var, name, value);
                    if (!in_loop) continue;
                    if (arg_used.has(name.name)) continue;
                    if (name.definition().orig.length == 1 && fn.functions.has(name.name)) continue;
                    expr_loop.push(init_ref(compressor, name));
                }
            });
            [].push.apply(decls, decl_var);
            [].push.apply(expressions, expr_loop);
            [].push.apply(expressions, expr_fn);
            [].push.apply(expressions, expr_var);
            return args;
        }

        function flatten_fn() {
            var decls = [];
            var expressions = [];
            if (has_default > 1 || has_destructured || has_spread || fn.rest) {
                flatten_destructured(decls, expressions);
            } else {
                flatten_args(decls, expressions);
            }
            var args = flatten_vars(decls, expressions);
            expressions.push(value);
            if (decls.length) args.push(make_node(AST_Var, fn, { definitions: decls }));
            [].splice.apply(scope.body, args);
            fn.enclosed.forEach(function(def) {
                if (scope.var_names().has(def.name)) return;
                scope.enclosed.push(def);
                scope.var_names().set(def.name, true);
            });
            return expressions;
        }
    });

    OPT(AST_New, function(self, compressor) {
        if (compressor.option("unsafe")) {
            var exp = self.expression;
            if (is_undeclared_ref(exp)) switch (exp.name) {
              case "Array":
              case "Error":
              case "Function":
              case "Object":
              case "RegExp":
                return make_node(AST_Call, self).transform(compressor);
            }
        }
        if (compressor.option("sequences")) {
            var seq = lift_sequence_in_expression(self, compressor);
            if (seq !== self) return seq.optimize(compressor);
        }
        if (compressor.option("unused")) drop_unused_call_args(self, compressor);
        return self;
    });

    // (a = b, x && a = c) ---> a = x ? c : b
    // (a = b, x || a = c) ---> a = x ? b : c
    function to_conditional_assignment(compressor, def, value, node) {
        if (!(node instanceof AST_Binary)) return;
        if (!(node.operator == "&&" || node.operator == "||")) return;
        if (!(node.right instanceof AST_Assign)) return;
        if (node.right.operator != "=") return;
        if (!(node.right.left instanceof AST_SymbolRef)) return;
        if (node.right.left.definition() !== def) return;
        if (value.has_side_effects(compressor)) return;
        if (!safe_from_assignment(node.left)) return;
        if (!safe_from_assignment(node.right.right)) return;
        def.replaced++;
        return node.operator == "&&" ? make_node(AST_Conditional, node, {
            condition: node.left,
            consequent: node.right.right,
            alternative: value,
        }) : make_node(AST_Conditional, node, {
            condition: node.left,
            consequent: value,
            alternative: node.right.right,
        });

        function safe_from_assignment(node) {
            if (node.has_side_effects(compressor)) return;
            var hit = false;
            node.walk(new TreeWalker(function(node) {
                if (hit) return true;
                if (node instanceof AST_SymbolRef && node.definition() === def) return hit = true;
            }));
            return !hit;
        }
    }

    OPT(AST_Sequence, function(self, compressor) {
        var expressions = filter_for_side_effects();
        var end = expressions.length - 1;
        merge_assignments();
        trim_right_for_undefined();
        if (end == 0) {
            self = maintain_this_binding(compressor.parent(), compressor.self(), expressions[0]);
            if (!(self instanceof AST_Sequence)) self = self.optimize(compressor);
            return self;
        }
        self.expressions = expressions;
        return self;

        function filter_for_side_effects() {
            if (!compressor.option("side_effects")) return self.expressions;
            var expressions = [];
            var first = first_in_statement(compressor);
            var last = self.expressions.length - 1;
            self.expressions.forEach(function(expr, index) {
                if (index < last) expr = expr.drop_side_effect_free(compressor, first);
                if (expr) {
                    merge_sequence(expressions, expr);
                    first = false;
                }
            });
            return expressions;
        }

        function trim_right_for_undefined() {
            if (!compressor.option("side_effects")) return;
            while (end > 0 && is_undefined(expressions[end], compressor)) end--;
            if (end < expressions.length - 1) {
                expressions[end] = make_node(AST_UnaryPrefix, self, {
                    operator: "void",
                    expression: expressions[end],
                });
                expressions.length = end + 1;
            }
        }

        function is_simple_assign(node) {
            return node instanceof AST_Assign
                && node.operator == "="
                && node.left instanceof AST_SymbolRef
                && node.left.definition();
        }

        function merge_assignments() {
            for (var i = 1; i < end; i++) {
                var prev = expressions[i - 1];
                var def = is_simple_assign(prev);
                if (!def) continue;
                var expr = expressions[i];
                if (compressor.option("conditionals")) {
                    var cond = to_conditional_assignment(compressor, def, prev.right, expr);
                    if (cond) {
                        prev.right = cond;
                        expressions.splice(i--, 1);
                        end--;
                        continue;
                    }
                }
                if (compressor.option("dead_code")
                    && is_simple_assign(expr) === def
                    && expr.right.is_constant_expression(def.scope.resolve())) {
                    expressions[--i] = prev.right;
                }
            }
        }
    });

    OPT(AST_UnaryPostfix, function(self, compressor) {
        if (compressor.option("sequences")) {
            var seq = lift_sequence_in_expression(self, compressor);
            if (seq !== self) return seq.optimize(compressor);
        }
        return try_evaluate(compressor, self);
    });

    var SIGN_OPS = makePredicate("+ -");
    var MULTIPLICATIVE_OPS = makePredicate("* / %");
    OPT(AST_UnaryPrefix, function(self, compressor) {
        var op = self.operator;
        var exp = self.expression;
        if (compressor.option("sequences") && can_lift()) {
            var seq = lift_sequence_in_expression(self, compressor);
            if (seq !== self) return seq.optimize(compressor);
        }
        switch (op) {
          case "+":
            if (!compressor.option("evaluate")) break;
            if (!exp.is_number(compressor, true)) break;
            var parent = compressor.parent();
            if (parent instanceof AST_UnaryPrefix && parent.operator == "delete") break;
            return exp;
          case "-":
            if (exp instanceof AST_Infinity) exp = exp.transform(compressor);
            // avoids infinite recursion of numerals
            if (exp instanceof AST_Number || exp instanceof AST_Infinity) return self;
            break;
          case "!":
            if (!compressor.option("booleans")) break;
            if (exp.is_truthy()) return make_sequence(self, [ exp, make_node(AST_False, self) ]).optimize(compressor);
            if (compressor.in_boolean_context()) {
                // !!foo ---> foo, if we're in boolean context
                if (exp instanceof AST_UnaryPrefix && exp.operator == "!") return exp.expression;
                if (exp instanceof AST_Binary) {
                    var first = first_in_statement(compressor);
                    self = (first ? best_of_statement : best_of_expression)(self, exp.negate(compressor, first));
                }
            }
            break;
          case "delete":
            if (!compressor.option("evaluate")) break;
            if (may_not_delete(exp)) break;
            return make_sequence(self, [ exp, make_node(AST_True, self) ]).optimize(compressor);
          case "typeof":
            if (!compressor.option("booleans")) break;
            if (!compressor.in_boolean_context()) break;
            // typeof always returns a non-empty string, thus always truthy
            AST_Node.warn("Boolean expression always true [{start}]", self);
            var exprs = [ make_node(AST_True, self) ];
            if (!(exp instanceof AST_SymbolRef && can_drop_symbol(exp, compressor))) exprs.unshift(exp);
            return make_sequence(self, exprs).optimize(compressor);
          case "void":
            if (!compressor.option("side_effects")) break;
            exp = exp.drop_side_effect_free(compressor);
            if (!exp) return make_node(AST_Undefined, self).optimize(compressor);
            self.expression = exp;
            return self;
        }
        if (compressor.option("evaluate")
            && exp instanceof AST_Binary
            && SIGN_OPS[op]
            && MULTIPLICATIVE_OPS[exp.operator]
            && (exp.left.is_constant() || !exp.right.has_side_effects(compressor))) {
            return make_node(AST_Binary, self, {
                operator: exp.operator,
                left: make_node(AST_UnaryPrefix, exp.left, {
                    operator: op,
                    expression: exp.left,
                }),
                right: exp.right,
            });
        }
        return try_evaluate(compressor, self);

        function may_not_delete(node) {
            return node instanceof AST_Infinity
                || node instanceof AST_NaN
                || node instanceof AST_NewTarget
                || node instanceof AST_PropAccess
                || node instanceof AST_SymbolRef
                || node instanceof AST_Undefined;
        }

        function can_lift() {
            switch (op) {
              case "delete":
                return !may_not_delete(exp.tail_node());
              case "typeof":
                return !is_undeclared_ref(exp.tail_node());
              default:
                return true;
            }
        }
    });

    OPT(AST_Await, function(self, compressor) {
        if (!compressor.option("awaits")) return self;
        if (compressor.option("sequences")) {
            var seq = lift_sequence_in_expression(self, compressor);
            if (seq !== self) return seq.optimize(compressor);
        }
        if (compressor.option("side_effects")) {
            var exp = self.expression;
            if (exp instanceof AST_Await) return exp.optimize(compressor);
            if (exp instanceof AST_UnaryPrefix && exp.expression instanceof AST_Await) return exp.optimize(compressor);
            for (var level = 0, node = self, parent; parent = compressor.parent(level++); node = parent) {
                if (is_arrow(parent)) {
                    if (parent.value === node) return exp.optimize(compressor);
                } else if (parent instanceof AST_Return) {
                    var drop = true;
                    do {
                        node = parent;
                        parent = compressor.parent(level++);
                        if (parent instanceof AST_Try && (parent.bfinally || parent.bcatch) !== node) {
                            drop = false;
                            break;
                        }
                    } while (parent && !(parent instanceof AST_Scope));
                    if (drop) return exp.optimize(compressor);
                } else if (parent instanceof AST_Sequence) {
                    if (parent.tail_node() === node) continue;
                }
                break;
            }
        }
        return self;
    });

    OPT(AST_Yield, function(self, compressor) {
        if (!compressor.option("yields")) return self;
        if (compressor.option("sequences")) {
            var seq = lift_sequence_in_expression(self, compressor);
            if (seq !== self) return seq.optimize(compressor);
        }
        var exp = self.expression;
        if (self.nested && exp.TYPE == "Call") {
            var inlined = exp.clone().optimize(compressor);
            if (inlined.TYPE != "Call") return inlined;
        }
        return self;
    });

    AST_Binary.DEFMETHOD("lift_sequences", function(compressor) {
        if (this.left instanceof AST_PropAccess) {
            if (!(this.left.expression instanceof AST_Sequence)) return this;
            var x = this.left.expression.expressions.slice();
            var e = this.clone();
            e.left = e.left.clone();
            e.left.expression = x.pop();
            x.push(e);
            return make_sequence(this, x);
        }
        if (this.left instanceof AST_Sequence) {
            var x = this.left.expressions.slice();
            var e = this.clone();
            e.left = x.pop();
            x.push(e);
            return make_sequence(this, x);
        }
        if (this.right instanceof AST_Sequence) {
            if (this.left.has_side_effects(compressor)) return this;
            var assign = this.operator == "=" && this.left instanceof AST_SymbolRef;
            var x = this.right.expressions;
            var last = x.length - 1;
            for (var i = 0; i < last; i++) {
                if (!assign && x[i].has_side_effects(compressor)) break;
            }
            if (i == last) {
                x = x.slice();
                var e = this.clone();
                e.right = x.pop();
                x.push(e);
                return make_sequence(this, x);
            }
            if (i > 0) {
                var e = this.clone();
                e.right = make_sequence(this.right, x.slice(i));
                x = x.slice(0, i);
                x.push(e);
                return make_sequence(this, x);
            }
        }
        return this;
    });

    var indexFns = makePredicate("indexOf lastIndexOf");
    var commutativeOperators = makePredicate("== === != !== * & | ^");
    function is_object(node, plain) {
        if (node instanceof AST_Assign) return !plain && node.operator == "=" && is_object(node.right);
        if (node instanceof AST_New) return !plain;
        if (node instanceof AST_Sequence) return is_object(node.tail_node(), plain);
        if (node instanceof AST_SymbolRef) return !plain && is_object(node.fixed_value());
        return node instanceof AST_Array
            || node instanceof AST_Class
            || node instanceof AST_Lambda
            || node instanceof AST_Object;
    }

    function can_drop_op(op, rhs, compressor) {
        switch (op) {
          case "in":
            return is_object(rhs) || compressor && compressor.option("unsafe_comps");
          case "instanceof":
            if (rhs instanceof AST_SymbolRef) rhs = rhs.fixed_value();
            return is_lambda(rhs) || compressor && compressor.option("unsafe_comps");
          default:
            return true;
        }
    }

    function needs_enqueuing(compressor, node) {
        if (node.is_constant()) return true;
        if (node instanceof AST_Assign) return node.operator != "=" || needs_enqueuing(compressor, node.right);
        if (node instanceof AST_Binary) {
            return !lazy_op[node.operator]
                || needs_enqueuing(compressor, node.left) && needs_enqueuing(compressor, node.right);
        }
        if (node instanceof AST_Call) return is_async(node.expression);
        if (node instanceof AST_Conditional) {
            return needs_enqueuing(compressor, node.consequent) && needs_enqueuing(compressor, node.alternative);
        }
        if (node instanceof AST_Sequence) return needs_enqueuing(compressor, node.tail_node());
        if (node instanceof AST_SymbolRef) {
            var fixed = node.fixed_value();
            return fixed && needs_enqueuing(compressor, fixed);
        }
        if (node instanceof AST_Template) return !node.tag || is_raw_tag(compressor, node.tag);
        if (node instanceof AST_Unary) return true;
    }

    function extract_lhs(node, compressor) {
        if (node instanceof AST_Assign) return is_lhs_read_only(node.left, compressor) ? node : node.left;
        if (node instanceof AST_Sequence) return extract_lhs(node.tail_node(), compressor);
        if (node instanceof AST_UnaryPrefix && UNARY_POSTFIX[node.operator]) {
            return is_lhs_read_only(node.expression, compressor) ? node : node.expression;
        }
        return node;
    }

    function repeatable(compressor, node) {
        if (node instanceof AST_Dot) return repeatable(compressor, node.expression);
        if (node instanceof AST_Sub) {
            return repeatable(compressor, node.expression) && repeatable(compressor, node.property);
        }
        if (node instanceof AST_Symbol) return true;
        return !node.has_side_effects(compressor);
    }

    function swap_chain(self, compressor) {
        var rhs = self.right.tail_node();
        if (rhs !== self.right) {
            var exprs = self.right.expressions.slice(0, -1);
            exprs.push(rhs.left);
            rhs = rhs.clone();
            rhs.left = make_sequence(self.right, exprs);
            self.right = rhs;
        }
        self.left = make_node(AST_Binary, self, {
            operator: self.operator,
            left: self.left,
            right: rhs.left,
            start: self.left.start,
            end: rhs.left.end,
        });
        self.right = rhs.right;
        if (compressor) {
            self.left = self.left.transform(compressor);
        } else if (self.operator == rhs.left.operator) {
            swap_chain(self.left);
        }
    }

    OPT(AST_Binary, function(self, compressor) {
        if (commutativeOperators[self.operator]
            && self.right.is_constant()
            && !self.left.is_constant()
            && !(self.left instanceof AST_Binary
                && PRECEDENCE[self.left.operator] >= PRECEDENCE[self.operator])) {
            // if right is a constant, whatever side effects the
            // left side might have could not influence the
            // result.  hence, force switch.
            reverse();
        }
        if (compressor.option("sequences")) {
            var seq = self.lift_sequences(compressor);
            if (seq !== self) return seq.optimize(compressor);
        }
        if (compressor.option("assignments") && lazy_op[self.operator]) {
            var lhs = extract_lhs(self.left, compressor);
            var right = self.right;
            // a || (a = x) ---> a = a || x
            // (a = x) && (a = y) ---> a = (a = x) && y
            if (lhs instanceof AST_SymbolRef
                && right instanceof AST_Assign
                && right.operator == "="
                && lhs.equals(right.left)) {
                lhs = lhs.clone();
                var assign = make_node(AST_Assign, self, {
                    operator: "=",
                    left: lhs,
                    right: make_node(AST_Binary, self, {
                        operator: self.operator,
                        left: self.left,
                        right: right.right,
                    }),
                });
                if (lhs.fixed) {
                    lhs.fixed = function() {
                        return assign.right;
                    };
                    lhs.fixed.assigns = [ assign ];
                }
                var def = lhs.definition();
                def.references.push(lhs);
                def.replaced++;
                return assign.optimize(compressor);
            }
        }
        if (compressor.option("comparisons")) switch (self.operator) {
          case "===":
          case "!==":
            if (is_undefined(self.left, compressor) && self.right.is_defined(compressor)) {
                AST_Node.warn("Expression always defined [{start}]", self);
                return make_sequence(self, [
                    self.right,
                    make_node(self.operator == "===" ? AST_False : AST_True, self),
                ]).optimize(compressor);
            }
            var is_strict_comparison = true;
            if ((self.left.is_string(compressor) && self.right.is_string(compressor)) ||
                (self.left.is_number(compressor) && self.right.is_number(compressor)) ||
                (self.left.is_boolean(compressor) && self.right.is_boolean(compressor)) ||
                repeatable(compressor, self.left) && self.left.equals(self.right)) {
                self.operator = self.operator.slice(0, 2);
            }
            // XXX: intentionally falling down to the next case
          case "==":
          case "!=":
            // void 0 == x ---> null == x
            if (!is_strict_comparison && is_undefined(self.left, compressor)) {
                self.left = make_node(AST_Null, self.left);
            }
            // "undefined" == typeof x ---> undefined === x
            else if (compressor.option("typeofs")
                && self.left instanceof AST_String
                && self.left.value == "undefined"
                && self.right instanceof AST_UnaryPrefix
                && self.right.operator == "typeof") {
                var expr = self.right.expression;
                if (expr instanceof AST_SymbolRef ? expr.is_declared(compressor)
                    : !(expr instanceof AST_PropAccess && compressor.option("ie"))) {
                    self.right = expr;
                    self.left = make_node(AST_Undefined, self.left).optimize(compressor);
                    if (self.operator.length == 2) self.operator += "=";
                }
            }
            // obj !== obj ---> false
            else if (self.left instanceof AST_SymbolRef
                && self.right instanceof AST_SymbolRef
                && self.left.definition() === self.right.definition()
                && is_object(self.left)) {
                return make_node(self.operator[0] == "=" ? AST_True : AST_False, self).optimize(compressor);
            }
            break;
          case "&&":
          case "||":
            // void 0 !== x && null !== x ---> null != x
            // void 0 === x || null === x ---> null == x
            var left = self.left;
            if (!(left instanceof AST_Binary)) break;
            if (left.operator != (self.operator == "&&" ? "!==" : "===")) break;
            if (!(self.right instanceof AST_Binary)) break;
            if (left.operator != self.right.operator) break;
            if (is_undefined(left.left, compressor) && self.right.left instanceof AST_Null
                || left.left instanceof AST_Null && is_undefined(self.right.left, compressor)) {
                var expr = left.right;
                if (expr instanceof AST_Assign && expr.operator == "=") expr = expr.left;
                if (expr.has_side_effects(compressor)) break;
                if (!expr.equals(self.right.right)) break;
                left.operator = left.operator.slice(0, -1);
                left.left = make_node(AST_Null, self);
                return left;
            }
            break;
        }
        var in_bool = false;
        var parent = compressor.parent();
        if (compressor.option("booleans")) {
            var lhs = extract_lhs(self.left, compressor);
            if (lazy_op[self.operator] && !lhs.has_side_effects(compressor)) {
                // a || a ---> a
                // (a = x) && a --> a = x
                if (lhs.equals(self.right)) {
                    return maintain_this_binding(parent, compressor.self(), self.left).optimize(compressor);
                }
                mark_duplicate_condition(compressor, lhs);
            }
            in_bool = compressor.in_boolean_context();
        }
        if (in_bool) switch (self.operator) {
          case "+":
            var ev = self.left.evaluate(compressor, true);
            if (ev && typeof ev == "string" || (ev = self.right.evaluate(compressor, true)) && typeof ev == "string") {
                AST_Node.warn("+ in boolean context always true [{start}]", self);
                var exprs = [];
                if (self.left.evaluate(compressor) instanceof AST_Node) exprs.push(self.left);
                if (self.right.evaluate(compressor) instanceof AST_Node) exprs.push(self.right);
                if (exprs.length < 2) {
                    exprs.push(make_node(AST_True, self));
                    return make_sequence(self, exprs).optimize(compressor);
                }
                self.truthy = true;
            }
            break;
          case "==":
            if (self.left instanceof AST_String && self.left.value == "" && self.right.is_string(compressor)) {
                return make_node(AST_UnaryPrefix, self, {
                    operator: "!",
                    expression: self.right,
                }).optimize(compressor);
            }
            break;
          case "!=":
            if (self.left instanceof AST_String && self.left.value == "" && self.right.is_string(compressor)) {
                return self.right.optimize(compressor);
            }
            break;
        }
        if (compressor.option("comparisons") && self.is_boolean(compressor)) {
            if (parent.TYPE != "Binary") {
                var negated = make_node(AST_UnaryPrefix, self, {
                    operator: "!",
                    expression: self.negate(compressor),
                });
                if (best_of(compressor, self, negated) === negated) return negated;
            }
            switch (self.operator) {
              case ">": reverse("<"); break;
              case ">=": reverse("<="); break;
            }
        }
        if (compressor.option("conditionals") && lazy_op[self.operator]) {
            if (self.left instanceof AST_Binary && self.operator == self.left.operator) {
                var before = make_node(AST_Binary, self, {
                    operator: self.operator,
                    left: self.left.right,
                    right: self.right,
                });
                var after = before.transform(compressor);
                if (before !== after) {
                    self.left = self.left.left;
                    self.right = after;
                }
            }
            // x && (y && z) ---> x && y && z
            // w || (x, y || z) ---> w || (x, y) || z
            var rhs = self.right.tail_node();
            if (rhs instanceof AST_Binary && self.operator == rhs.operator) swap_chain(self, compressor);
        }
        if (compressor.option("strings") && self.operator == "+") {
            // "foo" + 42 + "" ---> "foo" + 42
            if (self.right instanceof AST_String
                && self.right.value == ""
                && self.left.is_string(compressor)) {
                return self.left.optimize(compressor);
            }
            // "" + ("foo" + 42) ---> "foo" + 42
            if (self.left instanceof AST_String
                && self.left.value == ""
                && self.right.is_string(compressor)) {
                return self.right.optimize(compressor);
            }
            // "" + 42 + "foo" ---> 42 + "foo"
            if (self.left instanceof AST_Binary
                && self.left.operator == "+"
                && self.left.left instanceof AST_String
                && self.left.left.value == ""
                && self.right.is_string(compressor)
                && (self.left.right.is_constant() || !self.right.has_side_effects(compressor))) {
                self.left = self.left.right;
                return self.optimize(compressor);
            }
            // "x" + (y + "z") ---> "x" + y + "z"
            // w + (x, "y" + z) ---> w + (x, "y") + z
            var rhs = self.right.tail_node();
            if (rhs instanceof AST_Binary
                && self.operator == rhs.operator
                && (self.left.is_string(compressor) && rhs.is_string(compressor)
                    || rhs.left.is_string(compressor)
                        && (self.left.is_constant() || !rhs.right.has_side_effects(compressor)))) {
                swap_chain(self, compressor);
            }
        }
        if (compressor.option("evaluate")) {
            var associative = true;
            switch (self.operator) {
              case "&&":
                var ll = fuzzy_eval(compressor, self.left);
                if (!ll) {
                    AST_Node.warn("Condition left of && always false [{start}]", self);
                    return maintain_this_binding(parent, compressor.self(), self.left).optimize(compressor);
                } else if (!(ll instanceof AST_Node)) {
                    AST_Node.warn("Condition left of && always true [{start}]", self);
                    return make_sequence(self, [ self.left, self.right ]).optimize(compressor);
                }
                if (!self.right.evaluate(compressor, true)) {
                    if (in_bool && !(self.right.evaluate(compressor) instanceof AST_Node)) {
                        AST_Node.warn("Boolean && always false [{start}]", self);
                        return make_sequence(self, [ self.left, make_node(AST_False, self) ]).optimize(compressor);
                    } else self.falsy = true;
                } else if ((in_bool || parent.operator == "&&" && parent.left === compressor.self())
                    && !(self.right.evaluate(compressor) instanceof AST_Node)) {
                    AST_Node.warn("Dropping side-effect-free && [{start}]", self);
                    return self.left.optimize(compressor);
                }
                // (x || false) && y ---> x ? y : false
                if (self.left.operator == "||") {
                    var lr = fuzzy_eval(compressor, self.left.right);
                    if (!lr) return make_node(AST_Conditional, self, {
                        condition: self.left.left,
                        consequent: self.right,
                        alternative: self.left.right,
                    }).optimize(compressor);
                }
                break;
              case "??":
                var nullish = true;
              case "||":
                var ll = fuzzy_eval(compressor, self.left, nullish);
                if (nullish ? ll == null : !ll) {
                    AST_Node.warn("Condition left of {operator} always {value} [{start}]", {
                        operator: self.operator,
                        value: nullish ? "nullish" : "false",
                        start: self.start,
                    });
                    return make_sequence(self, [ self.left, self.right ]).optimize(compressor);
                } else if (!(ll instanceof AST_Node)) {
                    AST_Node.warn("Condition left of {operator} always {value} [{start}]", {
                        operator: self.operator,
                        value: nullish ? "defined" : "true",
                        start: self.start,
                    });
                    return maintain_this_binding(parent, compressor.self(), self.left).optimize(compressor);
                }
                var rr;
                if (!nullish && (rr = self.right.evaluate(compressor, true)) && !(rr instanceof AST_Node)) {
                    if (in_bool && !(self.right.evaluate(compressor) instanceof AST_Node)) {
                        AST_Node.warn("Boolean || always true [{start}]", self);
                        return make_sequence(self, [ self.left, make_node(AST_True, self) ]).optimize(compressor);
                    } else self.truthy = true;
                } else if ((in_bool || parent.operator == "||" && parent.left === compressor.self())
                    && !self.right.evaluate(compressor)) {
                    AST_Node.warn("Dropping side-effect-free {operator} [{start}]", self);
                    return self.left.optimize(compressor);
                }
                // x && true || y ---> x ? true : y
                if (!nullish && self.left.operator == "&&") {
                    var lr = fuzzy_eval(compressor, self.left.right);
                    if (lr && !(lr instanceof AST_Node)) return make_node(AST_Conditional, self, {
                        condition: self.left.left,
                        consequent: self.left.right,
                        alternative: self.right,
                    }).optimize(compressor);
                }
                break;
              case "+":
                // "foo" + ("bar" + x) ---> "foobar" + x
                if (self.left instanceof AST_Constant
                    && self.right instanceof AST_Binary
                    && self.right.operator == "+"
                    && self.right.left instanceof AST_Constant
                    && self.right.is_string(compressor)) {
                    self = make_node(AST_Binary, self, {
                        operator: "+",
                        left: make_node(AST_String, self.left, {
                            value: "" + self.left.value + self.right.left.value,
                            start: self.left.start,
                            end: self.right.left.end,
                        }),
                        right: self.right.right,
                    });
                }
                // (x + "foo") + "bar" ---> x + "foobar"
                if (self.right instanceof AST_Constant
                    && self.left instanceof AST_Binary
                    && self.left.operator == "+"
                    && self.left.right instanceof AST_Constant
                    && self.left.is_string(compressor)) {
                    self = make_node(AST_Binary, self, {
                        operator: "+",
                        left: self.left.left,
                        right: make_node(AST_String, self.right, {
                            value: "" + self.left.right.value + self.right.value,
                            start: self.left.right.start,
                            end: self.right.end,
                        }),
                    });
                }
                // a + -b ---> a - b
                if (self.right instanceof AST_UnaryPrefix
                    && self.right.operator == "-"
                    && self.left.is_number(compressor)) {
                    self = make_node(AST_Binary, self, {
                        operator: "-",
                        left: self.left,
                        right: self.right.expression,
                    });
                    break;
                }
                // -a + b ---> b - a
                if (self.left instanceof AST_UnaryPrefix
                    && self.left.operator == "-"
                    && reversible()
                    && self.right.is_number(compressor)) {
                    self = make_node(AST_Binary, self, {
                        operator: "-",
                        left: self.right,
                        right: self.left.expression,
                    });
                    break;
                }
                // (a + b) + 3 ---> 3 + (a + b)
                if (compressor.option("unsafe_math")
                    && self.left instanceof AST_Binary
                    && PRECEDENCE[self.left.operator] == PRECEDENCE[self.operator]
                    && self.right.is_constant()
                    && (self.right.is_boolean(compressor) || self.right.is_number(compressor))
                    && self.left.is_number(compressor)
                    && !self.left.right.is_constant()
                    && (self.left.left.is_boolean(compressor) || self.left.left.is_number(compressor))) {
                    self = make_node(AST_Binary, self, {
                        operator: self.left.operator,
                        left: make_node(AST_Binary, self, {
                            operator: self.operator,
                            left: self.right,
                            right: self.left.left,
                        }),
                        right: self.left.right,
                    });
                    break;
                }
              case "-":
                // a - -b ---> a + b
                if (self.right instanceof AST_UnaryPrefix
                    && self.right.operator == "-"
                    && self.left.is_number(compressor)
                    && self.right.expression.is_number(compressor)) {
                    self = make_node(AST_Binary, self, {
                        operator: "+",
                        left: self.left,
                        right: self.right.expression,
                    });
                    break;
                }
              case "*":
              case "/":
                associative = compressor.option("unsafe_math");
                // +a - b ---> a - b
                // a - +b ---> a - b
                if (self.operator != "+") [ "left", "right" ].forEach(function(operand) {
                    var node = self[operand];
                    if (node instanceof AST_UnaryPrefix && node.operator == "+") {
                        var exp = node.expression;
                        if (exp.is_boolean(compressor) || exp.is_number(compressor) || exp.is_string(compressor)) {
                            self[operand] = exp;
                        }
                    }
                });
              case "&":
              case "|":
              case "^":
                // a + +b ---> +b + a
                if (self.operator != "-"
                    && self.operator != "/"
                    && (self.left.is_boolean(compressor) || self.left.is_number(compressor))
                    && (self.right.is_boolean(compressor) || self.right.is_number(compressor))
                    && reversible()
                    && !(self.left instanceof AST_Binary
                        && self.left.operator != self.operator
                        && PRECEDENCE[self.left.operator] >= PRECEDENCE[self.operator])) {
                    self = best_of(compressor, self, make_node(AST_Binary, self, {
                        operator: self.operator,
                        left: self.right,
                        right: self.left,
                    }), self.right instanceof AST_Constant && !(self.left instanceof AST_Constant));
                }
                if (!associative || !self.is_number(compressor)) break;
                // a + (b + c) ---> (a + b) + c
                if (self.right instanceof AST_Binary
                    && self.right.operator != "%"
                    && PRECEDENCE[self.right.operator] == PRECEDENCE[self.operator]
                    && self.right.is_number(compressor)
                    && (self.operator != "+"
                        || self.right.left.is_boolean(compressor)
                        || self.right.left.is_number(compressor))
                    && (self.operator != "-" || !self.left.is_negative_zero())
                    && (self.right.left.is_constant_expression()
                        || !self.right.right.has_side_effects(compressor))
                    && !is_modify_array(self.right.right)) {
                    self = make_node(AST_Binary, self, {
                        operator: align(self.operator, self.right.operator),
                        left: make_node(AST_Binary, self.left, {
                            operator: self.operator,
                            left: self.left,
                            right: self.right.left,
                            start: self.left.start,
                            end: self.right.left.end,
                        }),
                        right: self.right.right,
                    });
                    if (self.operator == "+"
                        && !self.right.is_boolean(compressor)
                        && !self.right.is_number(compressor)) {
                        self.right = make_node(AST_UnaryPrefix, self.right, {
                            operator: "+",
                            expression: self.right,
                        });
                    }
                }
                // (2 * n) * 3 ---> 6 * n
                // (n + 2) + 3 ---> n + 5
                if (self.right instanceof AST_Constant
                    && self.left instanceof AST_Binary
                    && self.left.operator != "%"
                    && PRECEDENCE[self.left.operator] == PRECEDENCE[self.operator]
                    && self.left.is_number(compressor)) {
                    if (self.left.left instanceof AST_Constant) {
                        var lhs = make_binary(self.operator, self.left.left, self.right, {
                            start: self.left.left.start,
                            end: self.right.end,
                        });
                        self = make_binary(self.left.operator, try_evaluate(compressor, lhs), self.left.right, self);
                    } else if (self.left.right instanceof AST_Constant) {
                        var op = align(self.left.operator, self.operator);
                        var rhs = try_evaluate(compressor, make_binary(op, self.left.right, self.right, self.left));
                        if (rhs.is_constant()
                            && !(self.left.operator == "-"
                                && self.right.value != 0
                                && +rhs.value == 0
                                && self.left.left.is_negative_zero())) {
                            self = make_binary(self.left.operator, self.left.left, rhs, self);
                        }
                    }
                }
                break;
              case "instanceof":
                if (is_lambda(self.right)) return make_sequence(self, [
                    self,
                    make_node(AST_False, self),
                ]).optimize(compressor);
                break;
            }
            if (!(parent instanceof AST_UnaryPrefix && parent.operator == "delete")) {
                if (self.left instanceof AST_Number && !self.right.is_constant()) switch (self.operator) {
                  // 0 + n ---> n
                  case "+":
                    if (self.left.value == 0) {
                        if (self.right.is_boolean(compressor)) return make_node(AST_UnaryPrefix, self, {
                            operator: "+",
                            expression: self.right,
                        }).optimize(compressor);
                        if (self.right.is_number(compressor) && !self.right.is_negative_zero()) return self.right;
                    }
                    break;
                  // 1 * n ---> n
                  case "*":
                    if (self.left.value == 1) return make_node(AST_UnaryPrefix, self, {
                        operator: "+",
                        expression: self.right,
                    }).optimize(compressor);
                    break;
                }
                if (self.right instanceof AST_Number && !self.left.is_constant()) switch (self.operator) {
                  // n + 0 ---> n
                  case "+":
                    if (self.right.value == 0) {
                        if (self.left.is_boolean(compressor)) return make_node(AST_UnaryPrefix, self, {
                            operator: "+",
                            expression: self.left,
                        }).optimize(compressor);
                        if (self.left.is_number(compressor) && !self.left.is_negative_zero()) return self.left;
                    }
                    break;
                  // n - 0 ---> n
                  case "-":
                    if (self.right.value == 0) return make_node(AST_UnaryPrefix, self, {
                        operator: "+",
                        expression: self.left,
                    }).optimize(compressor);
                    break;
                  // n / 1 ---> n
                  case "/":
                    if (self.right.value == 1) return make_node(AST_UnaryPrefix, self, {
                        operator: "+",
                        expression: self.left,
                    }).optimize(compressor);
                    break;
                }
            }
        }
        if (compressor.option("typeofs")) switch (self.operator) {
          case "&&":
            mark_locally_defined(self.left, self.right, null);
            break;
          case "||":
            mark_locally_defined(self.left, null, self.right);
            break;
        }
        if (compressor.option("unsafe")) {
            var indexRight = is_indexFn(self.right);
            if (in_bool
                && indexRight
                && (self.operator == "==" || self.operator == "!=")
                && self.left instanceof AST_Number
                && self.left.value == 0) {
                return (self.operator == "==" ? make_node(AST_UnaryPrefix, self, {
                    operator: "!",
                    expression: self.right,
                }) : self.right).optimize(compressor);
            }
            var indexLeft = is_indexFn(self.left);
            if (compressor.option("comparisons") && is_indexOf_match_pattern()) {
                var node = make_node(AST_UnaryPrefix, self, {
                    operator: "!",
                    expression: make_node(AST_UnaryPrefix, self, {
                        operator: "~",
                        expression: indexLeft ? self.left : self.right,
                    }),
                });
                switch (self.operator) {
                  case "<":
                    if (indexLeft) break;
                  case "<=":
                  case "!=":
                    node = make_node(AST_UnaryPrefix, self, {
                        operator: "!",
                        expression: node,
                    });
                    break;
                }
                return node.optimize(compressor);
            }
        }
        return try_evaluate(compressor, self);

        function is_modify_array(node) {
            var found = false;
            node.walk(new TreeWalker(function(node) {
                if (found) return true;
                if (node instanceof AST_Assign) {
                    if (node.left instanceof AST_PropAccess) return found = true;
                } else if (node instanceof AST_Unary) {
                    if (unary_side_effects[node.operator] && node.expression instanceof AST_PropAccess) {
                        return found = true;
                    }
                }
            }));
            return found;
        }

        function align(ref, op) {
            switch (ref) {
              case "-":
                return op == "+" ? "-" : "+";
              case "/":
                return op == "*" ? "/" : "*";
              default:
                return op;
            }
        }

        function make_binary(op, left, right, orig) {
            if (op == "+") {
                if (!left.is_boolean(compressor) && !left.is_number(compressor)) {
                    left = make_node(AST_UnaryPrefix, left, {
                        operator: "+",
                        expression: left,
                    });
                }
                if (!right.is_boolean(compressor) && !right.is_number(compressor)) {
                    right = make_node(AST_UnaryPrefix, right, {
                        operator: "+",
                        expression: right,
                    });
                }
            }
            return make_node(AST_Binary, orig, {
                operator: op,
                left: left,
                right: right,
            });
        }

        function is_indexFn(node) {
            return node.TYPE == "Call"
                && node.expression instanceof AST_Dot
                && indexFns[node.expression.property];
        }

        function is_indexOf_match_pattern() {
            switch (self.operator) {
              case "<=":
                // 0 <= array.indexOf(string) ---> !!~array.indexOf(string)
                return indexRight && self.left instanceof AST_Number && self.left.value == 0;
              case "<":
                // array.indexOf(string) < 0 ---> !~array.indexOf(string)
                if (indexLeft && self.right instanceof AST_Number && self.right.value == 0) return true;
                // -1 < array.indexOf(string) ---> !!~array.indexOf(string)
              case "==":
              case "!=":
                // -1 == array.indexOf(string) ---> !~array.indexOf(string)
                // -1 != array.indexOf(string) ---> !!~array.indexOf(string)
                if (!indexRight) return false;
                return self.left instanceof AST_Number && self.left.value == -1
                    || self.left instanceof AST_UnaryPrefix && self.left.operator == "-"
                        && self.left.expression instanceof AST_Number && self.left.expression.value == 1;
            }
        }

        function reversible() {
            return self.left.is_constant()
                || self.right.is_constant()
                || !self.left.has_side_effects(compressor)
                    && !self.right.has_side_effects(compressor);
        }

        function reverse(op) {
            if (reversible()) {
                if (op) self.operator = op;
                var tmp = self.left;
                self.left = self.right;
                self.right = tmp;
            }
        }
    });

    OPT(AST_SymbolExport, function(self) {
        return self;
    });

    function recursive_ref(compressor, def, fn) {
        var level = 0, node = compressor.self();
        do {
            if (node === fn) return node;
            if (is_lambda(node) && node.name && node.name.definition() === def) return node;
        } while (node = compressor.parent(level++));
    }

    function same_scope(def) {
        var scope = def.scope.resolve();
        return all(def.references, function(ref) {
            return scope === ref.scope.resolve();
        });
    }

    OPT(AST_SymbolRef, function(self, compressor) {
        if (!compressor.option("ie")
            && is_undeclared_ref(self)
            // testing against `self.scope.uses_with` is an optimization
            && !(self.scope.resolve().uses_with && compressor.find_parent(AST_With))) {
            switch (self.name) {
              case "undefined":
                return make_node(AST_Undefined, self).optimize(compressor);
              case "NaN":
                return make_node(AST_NaN, self).optimize(compressor);
              case "Infinity":
                return make_node(AST_Infinity, self).optimize(compressor);
            }
        }
        var parent = compressor.parent();
        if (compressor.option("reduce_vars") && is_lhs(compressor.self(), parent) !== compressor.self()) {
            var def = self.definition();
            var fixed = self.fixed_value();
            var single_use = def.single_use && !(parent instanceof AST_Call && parent.is_expr_pure(compressor));
            if (single_use) {
                if (is_lambda(fixed)) {
                    if ((def.scope !== self.scope.resolve(true) || def.in_loop)
                        && (!compressor.option("reduce_funcs") || def.escaped.depth == 1 || fixed.inlined)) {
                        single_use = false;
                    } else if (def.redefined()) {
                        single_use = false;
                    } else if (recursive_ref(compressor, def, fixed)) {
                        single_use = false;
                    } else if (fixed.name && fixed.name.definition() !== def) {
                        single_use = false;
                    } else if (fixed.parent_scope !== self.scope || is_funarg(def)) {
                        if (!safe_from_strict_mode(fixed, compressor)) {
                            single_use = false;
                        } else if ((single_use = fixed.is_constant_expression(self.scope)) == "f") {
                            var scope = self.scope;
                            do {
                                if (scope instanceof AST_LambdaDefinition || scope instanceof AST_LambdaExpression) {
                                    scope.inlined = true;
                                }
                            } while (scope = scope.parent_scope);
                        }
                    } else if (fixed.name && (fixed.name.name == "await" && is_async(fixed)
                        || fixed.name.name == "yield" && is_generator(fixed))) {
                        single_use = false;
                    } else if (fixed.has_side_effects(compressor)) {
                        single_use = false;
                    } else if (compressor.option("ie") && fixed instanceof AST_Class) {
                        single_use = false;
                    }
                    if (single_use) fixed.parent_scope = self.scope;
                } else if (!fixed
                    || def.recursive_refs > 0
                    || !fixed.is_constant_expression()
                    || fixed.drop_side_effect_free(compressor)) {
                    single_use = false;
                }
            }
            if (single_use) {
                def.single_use = false;
                fixed._squeezed = true;
                fixed.single_use = true;
                if (fixed instanceof AST_DefClass) fixed = to_class_expr(fixed);
                if (fixed instanceof AST_LambdaDefinition) fixed = to_func_expr(fixed);
                if (is_lambda(fixed)) {
                    var scopes = [];
                    var scope = self.scope;
                    do {
                        scopes.push(scope);
                        if (scope === def.scope) break;
                    } while (scope = scope.parent_scope);
                    fixed.enclosed.forEach(function(def) {
                        if (fixed.variables.has(def.name)) return;
                        for (var i = 0; i < scopes.length; i++) {
                            var scope = scopes[i];
                            if (!push_uniq(scope.enclosed, def)) return;
                            scope.var_names().set(def.name, true);
                        }
                    });
                }
                var value;
                if (def.recursive_refs > 0) {
                    value = fixed.clone(true);
                    var defun_def = value.name.definition();
                    var lambda_def = value.variables.get(value.name.name);
                    var name = lambda_def && lambda_def.orig[0];
                    var def_fn_name, symbol_type;
                    if (value instanceof AST_Class) {
                        def_fn_name = "def_function";
                        symbol_type = AST_SymbolClass;
                    } else {
                        def_fn_name = "def_variable";
                        symbol_type = AST_SymbolLambda;
                    }
                    if (!(name instanceof symbol_type)) {
                        name = make_node(symbol_type, value.name);
                        name.scope = value;
                        value.name = name;
                        lambda_def = value[def_fn_name](name);
                        lambda_def.recursive_refs = def.recursive_refs;
                    }
                    value.walk(new TreeWalker(function(node) {
                        if (node instanceof AST_SymbolDeclaration) {
                            if (node !== name) {
                                var def = node.definition();
                                def.orig.push(node);
                                def.eliminated++;
                            }
                            return;
                        }
                        if (!(node instanceof AST_SymbolRef)) return;
                        var def = node.definition();
                        if (def === defun_def) {
                            node.thedef = def = lambda_def;
                        } else {
                            def.single_use = false;
                            var fn = node.fixed_value();
                            if (is_lambda(fn)
                                && fn.name
                                && fn.name.definition() === def
                                && def.scope === fn.name.scope
                                && fixed.variables.get(fn.name.name) === def) {
                                fn.name = fn.name.clone();
                                node.thedef = def = value.variables.get(fn.name.name) || value[def_fn_name](fn.name);
                            }
                        }
                        def.references.push(node);
                    }));
                } else {
                    if (fixed instanceof AST_Scope) {
                        compressor.push(fixed);
                        value = fixed.optimize(compressor);
                        compressor.pop();
                    } else {
                        value = fixed.optimize(compressor);
                    }
                    value = value.transform(new TreeTransformer(function(node, descend) {
                        if (node instanceof AST_Scope) return node;
                        node = node.clone();
                        descend(node, this);
                        return node;
                    }));
                }
                def.replaced++;
                return value;
            }
            var state;
            if (fixed && (state = self.fixed || def.fixed).should_replace !== false) {
                var ev, init;
                if (fixed instanceof AST_This) {
                    if (!is_funarg(def) && same_scope(def) && !cross_class(def)) init = fixed;
                } else if ((ev = fixed.evaluate(compressor, true)) !== fixed
                    && typeof ev != "function"
                    && (ev === null
                        || typeof ev != "object"
                        || compressor.option("unsafe_regexp")
                            && ev instanceof RegExp && !def.cross_loop && same_scope(def))) {
                    init = make_node_from_constant(ev, fixed);
                }
                if (init) {
                    if (state.should_replace === undefined) {
                        var value_length = init.optimize(compressor).print_to_string().length;
                        if (!has_symbol_ref(fixed)) {
                            value_length = Math.min(value_length, fixed.print_to_string().length);
                        }
                        var name_length = def.name.length;
                        if (compressor.option("unused") && !compressor.exposed(def)) {
                            var refs = def.references.length - def.replaced - def.assignments;
                            refs = Math.min(refs, def.references.filter(function(ref) {
                                return ref.fixed === state;
                            }).length);
                            name_length += (name_length + 2 + value_length) / Math.max(1, refs);
                        }
                        state.should_replace = value_length - Math.floor(name_length) < compressor.eval_threshold;
                    }
                    if (state.should_replace) {
                        var value;
                        if (has_symbol_ref(fixed)) {
                            value = init.optimize(compressor);
                            if (value === init) value = value.clone(true);
                        } else {
                            value = best_of_expression(init.optimize(compressor), fixed);
                            if (value === init || value === fixed) value = value.clone(true);
                        }
                        def.replaced++;
                        return value;
                    }
                }
            }
        }
        return self;

        function cross_class(def) {
            var scope = self.scope;
            while (scope !== def.scope) {
                if (scope instanceof AST_Class) return true;
                scope = scope.parent_scope;
            }
        }

        function has_symbol_ref(value) {
            var found;
            value.walk(new TreeWalker(function(node) {
                if (node instanceof AST_SymbolRef) found = true;
                if (found) return true;
            }));
            return found;
        }
    });

    function is_raw_tag(compressor, tag) {
        return compressor.option("unsafe")
            && tag instanceof AST_Dot
            && tag.property == "raw"
            && is_undeclared_ref(tag.expression)
            && tag.expression.name == "String";
    }

    function decode_template(str) {
        var malformed = false;
        str = str.replace(/\\(u\{[^{}]*\}?|u[\s\S]{0,4}|x[\s\S]{0,2}|[0-9]+|[\s\S])/g, function(match, seq) {
            var ch = decode_escape_sequence(seq);
            if (typeof ch == "string") return ch;
            malformed = true;
        });
        if (!malformed) return str;
    }

    OPT(AST_Template, function(self, compressor) {
        if (!compressor.option("templates")) return self;
        var tag = self.tag;
        if (!tag || is_raw_tag(compressor, tag)) {
            var exprs = [];
            var strs = [];
            for (var i = 0, status; i < self.strings.length; i++) {
                var str = self.strings[i];
                if (!tag) {
                    var trimmed = decode_template(str);
                    if (trimmed) str = escape_literal(trimmed);
                }
                if (i > 0) {
                    var node = self.expressions[i - 1];
                    var value = should_join(node);
                    if (value) {
                        var prev = strs[strs.length - 1];
                        var joined = prev + value + str;
                        var decoded;
                        if (tag || typeof (decoded = decode_template(joined)) == status) {
                            strs[strs.length - 1] = decoded ? escape_literal(decoded) : joined;
                            continue;
                        }
                    }
                    exprs.push(node);
                }
                strs.push(str);
                if (!tag) status = typeof trimmed;
            }
            if (!tag && strs.length > 1) {
                if (strs[strs.length - 1] == "") return make_node(AST_Binary, self, {
                    operator: "+",
                    left: make_node(AST_Template, self, {
                        expressions: exprs.slice(0, -1),
                        strings: strs.slice(0, -1),
                    }).transform(compressor),
                    right: exprs[exprs.length - 1],
                }).optimize(compressor);
                if (strs[0] == "") {
                    var left = make_node(AST_Binary, self, {
                        operator: "+",
                        left: make_node(AST_String, self, { value: "" }),
                        right: exprs[0],
                    });
                    for (var i = 1; strs[i] == "" && i < exprs.length; i++) {
                        left = make_node(AST_Binary, self, {
                            operator: "+",
                            left: left,
                            right: exprs[i],
                        });
                    }
                    return best_of(compressor, self, make_node(AST_Binary, self, {
                        operator: "+",
                        left: left.transform(compressor),
                        right: make_node(AST_Template, self, {
                            expressions: exprs.slice(i),
                            strings: strs.slice(i),
                        }).transform(compressor),
                    }).optimize(compressor));
                }
            }
            self.expressions = exprs;
            self.strings = strs;
        }
        return try_evaluate(compressor, self);

        function escape_literal(str) {
            return str.replace(/\r|\\|`|\${/g, function(s) {
                return "\\" + (s == "\r" ? "r" : s);
            });
        }

        function should_join(node) {
            var ev = node.evaluate(compressor);
            if (ev === node) return;
            if (tag && /\r|\\|`/.test(ev)) return;
            ev = escape_literal("" + ev);
            if (ev.length > node.print_to_string().length + "${}".length) return;
            return ev;
        }
    });

    function is_atomic(lhs, self) {
        return lhs instanceof AST_SymbolRef || lhs.TYPE === self.TYPE;
    }

    OPT(AST_Undefined, function(self, compressor) {
        if (compressor.option("unsafe_undefined")) {
            var undef = find_scope(compressor).find_variable("undefined");
            if (undef) {
                var ref = make_node(AST_SymbolRef, self, {
                    name: "undefined",
                    scope: undef.scope,
                    thedef: undef,
                });
                ref.is_undefined = true;
                return ref;
            }
        }
        var lhs = is_lhs(compressor.self(), compressor.parent());
        if (lhs && is_atomic(lhs, self)) return self;
        return make_node(AST_UnaryPrefix, self, {
            operator: "void",
            expression: make_node(AST_Number, self, { value: 0 }),
        });
    });

    OPT(AST_Infinity, function(self, compressor) {
        var lhs = is_lhs(compressor.self(), compressor.parent());
        if (lhs && is_atomic(lhs, self)) return self;
        if (compressor.option("keep_infinity") && !lhs && !find_scope(compressor).find_variable("Infinity")) {
            return self;
        }
        return make_node(AST_Binary, self, {
            operator: "/",
            left: make_node(AST_Number, self, { value: 1 }),
            right: make_node(AST_Number, self, { value: 0 }),
        });
    });

    OPT(AST_NaN, function(self, compressor) {
        var lhs = is_lhs(compressor.self(), compressor.parent());
        if (lhs && is_atomic(lhs, self)) return self;
        if (!lhs && !find_scope(compressor).find_variable("NaN")) return self;
        return make_node(AST_Binary, self, {
            operator: "/",
            left: make_node(AST_Number, self, { value: 0 }),
            right: make_node(AST_Number, self, { value: 0 }),
        });
    });

    function is_reachable(self, defs) {
        var reachable = false;
        var find_ref = new TreeWalker(function(node) {
            if (reachable) return true;
            if (node instanceof AST_SymbolRef && member(node.definition(), defs)) return reachable = true;
        });
        var scan_scope = new TreeWalker(function(node) {
            if (reachable) return true;
            if (node instanceof AST_Lambda && node !== self) {
                if (!(node.name || is_async(node) || is_generator(node))) {
                    var parent = scan_scope.parent();
                    if (parent instanceof AST_Call && parent.expression === node) return;
                }
                node.walk(find_ref);
                return true;
            }
        });
        self.walk(scan_scope);
        return reachable;
    }

    var ASSIGN_OPS = makePredicate("+ - * / % >> << >>> | ^ &");
    var ASSIGN_OPS_COMMUTATIVE = makePredicate("* | ^ &");
    OPT(AST_Assign, function(self, compressor) {
        if (compressor.option("dead_code")) {
            if (self.left instanceof AST_PropAccess) {
                if (self.operator == "=") {
                    if (self.redundant) {
                        var exprs = [ self.left.expression ];
                        if (self.left instanceof AST_Sub) exprs.push(self.left.property);
                        exprs.push(self.right);
                        return make_sequence(self, exprs).optimize(compressor);
                    }
                    if (self.left.equals(self.right) && !self.left.has_side_effects(compressor)) {
                        return self.right;
                    }
                    var exp = self.left.expression;
                    if (exp instanceof AST_Lambda
                        || !compressor.has_directive("use strict")
                            && exp instanceof AST_Constant
                            && !exp.may_throw_on_access(compressor)) {
                        return self.left instanceof AST_Dot ? self.right : make_sequence(self, [
                            self.left.property,
                            self.right
                        ]).optimize(compressor);
                    }
                }
            } else if (self.left instanceof AST_SymbolRef && can_drop_symbol(self.left, compressor)) {
                var parent;
                if (self.operator == "=" && self.left.equals(self.right)
                    && !((parent = compressor.parent()) instanceof AST_UnaryPrefix && parent.operator == "delete")) {
                    return self.right;
                }
                if (self.left.is_immutable()) return strip_assignment();
                var def = self.left.definition();
                var scope = def.scope.resolve();
                var local = scope === compressor.find_parent(AST_Lambda);
                var level = 0, node;
                parent = compressor.self();
                if (!(scope.uses_arguments && is_funarg(def)) || compressor.has_directive("use strict")) do {
                    node = parent;
                    parent = compressor.parent(level++);
                    if (parent instanceof AST_Assign) {
                        if (parent.left instanceof AST_SymbolRef && parent.left.definition() === def) {
                            if (in_try(level, parent, !local)) break;
                            return strip_assignment(def);
                        }
                        if (parent.left.match_symbol(function(node) {
                            if (node instanceof AST_PropAccess) return true;
                        })) break;
                        continue;
                    }
                    if (parent instanceof AST_Exit) {
                        if (!local) break;
                        if (in_try(level, parent)) break;
                        if (is_reachable(scope, [ def ])) break;
                        return strip_assignment(def);
                    }
                    if (parent instanceof AST_SimpleStatement) {
                        if (!local) break;
                        if (is_reachable(scope, [ def ])) break;
                        var stat;
                        do {
                            stat = parent;
                            parent = compressor.parent(level++);
                            if (parent === scope && is_last_statement(parent.body, stat)) return strip_assignment(def);
                        } while (is_tail_block(stat, parent));
                        break;
                    }
                    if (parent instanceof AST_VarDef) {
                        if (!(parent.name instanceof AST_SymbolDeclaration)) continue;
                        if (parent.name.definition() !== def) continue;
                        if (in_try(level, parent)) break;
                        return strip_assignment(def);
                    }
                } while (is_tail(node, parent));
            }
        }
        if (compressor.option("sequences")) {
            var seq = self.lift_sequences(compressor);
            if (seq !== self) return seq.optimize(compressor);
        }
        if (compressor.option("assignments")) {
            if (self.operator == "=" && self.left instanceof AST_SymbolRef && self.right instanceof AST_Binary) {
                // x = expr1 OP expr2
                if (self.right.left instanceof AST_SymbolRef
                    && self.right.left.name == self.left.name
                    && ASSIGN_OPS[self.right.operator]) {
                    // x = x - 2 ---> x -= 2
                    return make_compound(self.right.right);
                }
                if (self.right.right instanceof AST_SymbolRef
                    && self.right.right.name == self.left.name
                    && ASSIGN_OPS_COMMUTATIVE[self.right.operator]
                    && !self.right.left.has_side_effects(compressor)) {
                    // x = 2 & x ---> x &= 2
                    return make_compound(self.right.left);
                }
            }
            if ((self.operator == "-=" || self.operator == "+="
                    && (self.left.is_boolean(compressor) || self.left.is_number(compressor)))
                && self.right instanceof AST_Number
                && self.right.value == 1) {
                var op = self.operator.slice(0, -1);
                return make_node(AST_UnaryPrefix, self, {
                    operator: op + op,
                    expression: self.left,
                });
            }
        }
        return try_evaluate(compressor, self);

        function is_tail(node, parent) {
            if (parent instanceof AST_Binary) switch (node) {
              case parent.left:
                return parent.right.is_constant_expression(scope);
              case parent.right:
                return true;
              default:
                return false;
            }
            if (parent instanceof AST_Conditional) switch (node) {
              case parent.condition:
                return parent.consequent.is_constant_expression(scope)
                    && parent.alternative.is_constant_expression(scope);
              case parent.consequent:
              case parent.alternative:
                return true;
              default:
                return false;
            }
            if (parent instanceof AST_Sequence) {
                var exprs = parent.expressions;
                var stop = exprs.indexOf(node);
                if (stop < 0) return false;
                for (var i = exprs.length; --i > stop;) {
                    if (!exprs[i].is_constant_expression(scope)) return false;
                }
                return true;
            }
            return parent instanceof AST_UnaryPrefix;
        }

        function is_tail_block(stat, parent) {
            if (parent instanceof AST_BlockStatement) return is_last_statement(parent.body, stat);
            if (parent instanceof AST_Catch) return is_last_statement(parent.body, stat);
            if (parent instanceof AST_Finally) return is_last_statement(parent.body, stat);
            if (parent instanceof AST_If) return parent.body === stat || parent.alternative === stat;
            if (parent instanceof AST_Try) return parent.bfinally ? parent.bfinally === stat : parent.bcatch === stat;
        }

        function in_try(level, node, sync) {
            var right = self.right;
            self.right = make_node(AST_Null, right);
            var may_throw = node.may_throw(compressor);
            self.right = right;
            return find_try(compressor, level, node, scope, may_throw, sync);
        }

        function make_compound(rhs) {
            var fixed = self.left.fixed;
            if (fixed) fixed.to_binary = replace_ref(function(node) {
                return node.left;
            }, fixed);
            return make_node(AST_Assign, self, {
                operator: self.right.operator + "=",
                left: self.left,
                right: rhs,
            });
        }

        function strip_assignment(def) {
            if (def) def.fixed = false;
            return (self.operator != "=" ? make_node(AST_Binary, self, {
                operator: self.operator.slice(0, -1),
                left: self.left,
                right: self.right,
            }) : maintain_this_binding(compressor.parent(), self, self.right)).optimize(compressor);
        }
    });

    OPT(AST_Conditional, function(self, compressor) {
        if (compressor.option("sequences") && self.condition instanceof AST_Sequence) {
            var expressions = self.condition.expressions.slice();
            var node = self.clone();
            node.condition = expressions.pop();
            expressions.push(node);
            return make_sequence(self, expressions).optimize(compressor);
        }
        if (!compressor.option("conditionals")) return self;
        var condition = self.condition;
        if (compressor.option("booleans") && !condition.has_side_effects(compressor)) {
            mark_duplicate_condition(compressor, condition);
        }
        condition = fuzzy_eval(compressor, condition);
        if (!condition) {
            AST_Node.warn("Condition always false [{start}]", self);
            return make_sequence(self, [ self.condition, self.alternative ]).optimize(compressor);
        } else if (!(condition instanceof AST_Node)) {
            AST_Node.warn("Condition always true [{start}]", self);
            return make_sequence(self, [ self.condition, self.consequent ]).optimize(compressor);
        }
        var first = first_in_statement(compressor);
        var negated = condition.negate(compressor, first);
        if ((first ? best_of_statement : best_of_expression)(condition, negated) === negated) {
            self = make_node(AST_Conditional, self, {
                condition: negated,
                consequent: self.alternative,
                alternative: self.consequent,
            });
            negated = condition;
            condition = self.condition;
        }
        var consequent = self.consequent;
        var alternative = self.alternative;
        var cond_lhs = extract_lhs(condition, compressor);
        if (repeatable(compressor, cond_lhs)) {
            // x ? x : y ---> x || y
            if (cond_lhs.equals(consequent)) return make_node(AST_Binary, self, {
                operator: "||",
                left: condition,
                right: alternative,
            }).optimize(compressor);
            // x ? y : x ---> x && y
            if (cond_lhs.equals(alternative)) return make_node(AST_Binary, self, {
                operator: "&&",
                left: condition,
                right: consequent,
            }).optimize(compressor);
        }
        // if (foo) exp = something; else exp = something_else;
        //                   |
        //                   v
        // exp = foo ? something : something_else;
        var seq_tail = consequent.tail_node();
        if (seq_tail instanceof AST_Assign) {
            var is_eq = seq_tail.operator == "=";
            var alt_tail = is_eq ? alternative.tail_node() : alternative;
            if ((is_eq || consequent === seq_tail)
                && alt_tail instanceof AST_Assign
                && seq_tail.operator == alt_tail.operator
                && seq_tail.left.equals(alt_tail.left)
                && (is_eq && seq_tail.left instanceof AST_SymbolRef
                    || !condition.has_side_effects(compressor)
                        && can_shift_lhs_of_tail(consequent)
                        && can_shift_lhs_of_tail(alternative))) {
                return make_node(AST_Assign, self, {
                    operator: seq_tail.operator,
                    left: seq_tail.left,
                    right: make_node(AST_Conditional, self, {
                        condition: condition,
                        consequent: pop_lhs(consequent),
                        alternative: pop_lhs(alternative),
                    }),
                });
            }
        }
        var alt_tail = alternative.tail_node();
        // x ? y : y ---> x, y
        // x ? (a, c) : (b, c) ---> x ? a : b, c
        if (seq_tail.equals(alt_tail)) return make_sequence(self, consequent.equals(alternative) ? [
            condition,
            consequent,
        ] : [
            make_node(AST_Conditional, self, {
                condition: condition,
                consequent: pop_seq(consequent),
                alternative: pop_seq(alternative),
            }),
            alt_tail,
        ]).optimize(compressor);
        // x ? y.p : z.p ---> (x ? y : z).p
        // x ? y(a) : z(a) ---> (x ? y : z)(a)
        // x ? y.f(a) : z.f(a) ---> (x ? y : z).f(a)
        var combined = combine_tail(consequent, alternative, true);
        if (combined) return combined;
        // x ? y(a) : y(b) ---> y(x ? a : b)
        var arg_index;
        if (consequent instanceof AST_Call
            && alternative.TYPE == consequent.TYPE
            && (arg_index = arg_diff(consequent, alternative)) >= 0
            && consequent.expression.equals(alternative.expression)
            && !condition.has_side_effects(compressor)
            && !consequent.expression.has_side_effects(compressor)) {
            var node = consequent.clone();
            var arg = consequent.args[arg_index];
            node.args[arg_index] = arg instanceof AST_Spread ? make_node(AST_Spread, self, {
                expression: make_node(AST_Conditional, self, {
                    condition: condition,
                    consequent: arg.expression,
                    alternative: alternative.args[arg_index].expression,
                }),
            }) : make_node(AST_Conditional, self, {
                condition: condition,
                consequent: arg,
                alternative: alternative.args[arg_index],
            });
            return node;
        }
        // x ? (y ? a : b) : b ---> x && y ? a : b
        if (seq_tail instanceof AST_Conditional
            && seq_tail.alternative.equals(alternative)) {
            return make_node(AST_Conditional, self, {
                condition: make_node(AST_Binary, self, {
                    left: condition,
                    operator: "&&",
                    right: fuse(consequent, seq_tail, "condition"),
                }),
                consequent: seq_tail.consequent,
                alternative: merge_expression(seq_tail.alternative, alternative),
            });
        }
        // x ? (y ? a : b) : a ---> !x || y ? a : b
        if (seq_tail instanceof AST_Conditional
            && seq_tail.consequent.equals(alternative)) {
            return make_node(AST_Conditional, self, {
                condition: make_node(AST_Binary, self, {
                    left: negated,
                    operator: "||",
                    right: fuse(consequent, seq_tail, "condition"),
                }),
                consequent: merge_expression(seq_tail.consequent, alternative),
                alternative: seq_tail.alternative,
            });
        }
        // x ? a : (y ? a : b) ---> x || y ? a : b
        if (alt_tail instanceof AST_Conditional
            && consequent.equals(alt_tail.consequent)) {
            return make_node(AST_Conditional, self, {
                condition: make_node(AST_Binary, self, {
                    left: condition,
                    operator: "||",
                    right: fuse(alternative, alt_tail, "condition"),
                }),
                consequent: merge_expression(consequent, alt_tail.consequent),
                alternative: alt_tail.alternative,
            });
        }
        // x ? b : (y ? a : b) ---> !x && y ? a : b
        if (alt_tail instanceof AST_Conditional
            && consequent.equals(alt_tail.alternative)) {
            return make_node(AST_Conditional, self, {
                condition: make_node(AST_Binary, self, {
                    left: negated,
                    operator: "&&",
                    right: fuse(alternative, alt_tail, "condition"),
                }),
                consequent: alt_tail.consequent,
                alternative: merge_expression(consequent, alt_tail.alternative),
            });
        }
        // x ? y && a : a ---> (!x || y) && a
        if (seq_tail instanceof AST_Binary
            && seq_tail.operator == "&&"
            && seq_tail.right.equals(alternative)) {
            return make_node(AST_Binary, self, {
                operator: "&&",
                left: make_node(AST_Binary, self, {
                    operator: "||",
                    left: negated,
                    right: fuse(consequent, seq_tail, "left"),
                }),
                right: merge_expression(seq_tail.right, alternative),
            }).optimize(compressor);
        }
        // x ? y || a : a ---> x && y || a
        if (seq_tail instanceof AST_Binary
            && seq_tail.operator == "||"
            && seq_tail.right.equals(alternative)) {
            return make_node(AST_Binary, self, {
                operator: "||",
                left: make_node(AST_Binary, self, {
                    operator: "&&",
                    left: condition,
                    right: fuse(consequent, seq_tail, "left"),
                }),
                right: merge_expression(seq_tail.right, alternative),
            }).optimize(compressor);
        }
        // x ? a : y && a ---> (x || y) && a
        if (alt_tail instanceof AST_Binary
            && alt_tail.operator == "&&"
            && alt_tail.right.equals(consequent)) {
            return make_node(AST_Binary, self, {
                operator: "&&",
                left: make_node(AST_Binary, self, {
                    operator: "||",
                    left: condition,
                    right: fuse(alternative, alt_tail, "left"),
                }),
                right: merge_expression(consequent, alt_tail.right),
            }).optimize(compressor);
        }
        // x ? a : y || a ---> !x && y || a
        if (alt_tail instanceof AST_Binary
            && alt_tail.operator == "||"
            && alt_tail.right.equals(consequent)) {
            return make_node(AST_Binary, self, {
                operator: "||",
                left: make_node(AST_Binary, self, {
                    operator: "&&",
                    left: negated,
                    right: fuse(alternative, alt_tail, "left"),
                }),
                right: merge_expression(consequent, alt_tail.right),
            }).optimize(compressor);
        }
        var in_bool = compressor.option("booleans") && compressor.in_boolean_context();
        if (is_true(consequent)) {
            // c ? true : false ---> !!c
            if (is_false(alternative)) return booleanize(condition);
            // c ? true : x ---> !!c || x
            return make_node(AST_Binary, self, {
                operator: "||",
                left: booleanize(condition),
                right: alternative,
            }).optimize(compressor);
        }
        if (is_false(consequent)) {
            // c ? false : true ---> !c
            if (is_true(alternative)) return booleanize(condition.negate(compressor));
            // c ? false : x ---> !c && x
            return make_node(AST_Binary, self, {
                operator: "&&",
                left: booleanize(condition.negate(compressor)),
                right: alternative,
            }).optimize(compressor);
        }
        // c ? x : true ---> !c || x
        if (is_true(alternative)) return make_node(AST_Binary, self, {
            operator: "||",
            left: booleanize(condition.negate(compressor)),
            right: consequent,
        }).optimize(compressor);
        // c ? x : false ---> !!c && x
        if (is_false(alternative)) return make_node(AST_Binary, self, {
            operator: "&&",
            left: booleanize(condition),
            right: consequent,
        }).optimize(compressor);
        if (compressor.option("typeofs")) mark_locally_defined(condition, consequent, alternative);
        return self;

        function booleanize(node) {
            if (node.is_boolean(compressor)) return node;
            // !!expression
            return make_node(AST_UnaryPrefix, node, {
                operator: "!",
                expression: node.negate(compressor),
            });
        }

        // AST_True or !0
        function is_true(node) {
            return node instanceof AST_True
                || in_bool
                    && node instanceof AST_Constant
                    && node.value
                || (node instanceof AST_UnaryPrefix
                    && node.operator == "!"
                    && node.expression instanceof AST_Constant
                    && !node.expression.value);
        }
        // AST_False or !1 or void 0
        function is_false(node) {
            return node instanceof AST_False
                || in_bool
                    && (node instanceof AST_Constant
                            && !node.value
                        || node instanceof AST_UnaryPrefix
                            && node.operator == "void"
                            && !node.expression.has_side_effects(compressor))
                || (node instanceof AST_UnaryPrefix
                    && node.operator == "!"
                    && node.expression instanceof AST_Constant
                    && node.expression.value);
        }

        function arg_diff(consequent, alternative) {
            var a = consequent.args;
            var b = alternative.args;
            var len = a.length;
            if (len != b.length) return -2;
            for (var i = 0; i < len; i++) {
                if (!a[i].equals(b[i])) {
                    if (a[i] instanceof AST_Spread !== b[i] instanceof AST_Spread) return -3;
                    for (var j = i + 1; j < len; j++) {
                        if (!a[j].equals(b[j])) return -2;
                    }
                    return i;
                }
            }
            return -1;
        }

        function fuse(node, tail, prop) {
            if (node === tail) return tail[prop];
            var exprs = node.expressions.slice(0, -1);
            exprs.push(tail[prop]);
            return make_sequence(node, exprs);
        }

        function is_tail_equivalent(consequent, alternative) {
            if (consequent.TYPE != alternative.TYPE) return;
            if (consequent.optional != alternative.optional) return;
            if (consequent instanceof AST_Call) {
                if (arg_diff(consequent, alternative) != -1) return;
                return consequent.TYPE != "Call"
                    || !(consequent.expression instanceof AST_PropAccess
                        || alternative.expression instanceof AST_PropAccess)
                    || is_tail_equivalent(consequent.expression, alternative.expression);
            }
            if (!(consequent instanceof AST_PropAccess)) return;
            var p = consequent.property;
            var q = alternative.property;
            return (p instanceof AST_Node ? p.equals(q) : p == q)
                && !(consequent.expression instanceof AST_Super || alternative.expression instanceof AST_Super);
        }

        function combine_tail(consequent, alternative, top) {
            var seq_tail = consequent.tail_node();
            var alt_tail = alternative.tail_node();
            if (!is_tail_equivalent(seq_tail, alt_tail)) return !top && make_node(AST_Conditional, self, {
                condition: condition,
                consequent: consequent,
                alternative: alternative,
            });
            var node = seq_tail.clone();
            var seq_expr = fuse(consequent, seq_tail, "expression");
            var alt_expr = fuse(alternative, alt_tail, "expression");
            var combined = combine_tail(seq_expr, alt_expr);
            if (seq_tail.expression instanceof AST_Sequence) {
                combined = maintain_this_binding(seq_tail, seq_tail.expression, combined);
            }
            node.expression = combined;
            return node;
        }

        function can_shift_lhs_of_tail(node) {
            return node === node.tail_node() || all(node.expressions.slice(0, -1), function(expr) {
                return !expr.has_side_effects(compressor);
            });
        }

        function pop_lhs(node) {
            if (!(node instanceof AST_Sequence)) return node.right;
            var exprs = node.expressions.slice();
            exprs.push(exprs.pop().right);
            return make_sequence(node, exprs);
        }

        function pop_seq(node) {
            if (!(node instanceof AST_Sequence)) return make_node(AST_Number, node, { value: 0 });
            return make_sequence(node, node.expressions.slice(0, -1));
        }
    });

    OPT(AST_Boolean, function(self, compressor) {
        if (!compressor.option("booleans")) return self;
        if (compressor.in_boolean_context()) return make_node(AST_Number, self, { value: +self.value });
        var p = compressor.parent();
        if (p instanceof AST_Binary && (p.operator == "==" || p.operator == "!=")) {
            AST_Node.warn("Non-strict equality against boolean: {operator} {value} [{start}]", {
                operator: p.operator,
                value: self.value,
                start: p.start,
            });
            return make_node(AST_Number, self, { value: +self.value });
        }
        return make_node(AST_UnaryPrefix, self, {
            operator: "!",
            expression: make_node(AST_Number, self, { value: 1 - self.value }),
        });
    });

    OPT(AST_Spread, function(self, compressor) {
        var exp = self.expression;
        if (compressor.option("spreads") && exp instanceof AST_Array && !(compressor.parent() instanceof AST_Object)) {
            return List.splice(exp.elements.map(function(node) {
                return node instanceof AST_Hole ? make_node(AST_Undefined, node).optimize(compressor) : node;
            }));
        }
        return self;
    });

    function safe_to_flatten(value, compressor) {
        if (!value) return false;
        var parent = compressor.parent();
        if (parent.TYPE != "Call") return true;
        if (parent.expression !== compressor.self()) return true;
        if (value instanceof AST_SymbolRef) {
            value = value.fixed_value();
            if (!value) return false;
        }
        return value instanceof AST_Lambda && !value.contains_this();
    }

    OPT(AST_Sub, function(self, compressor) {
        var expr = self.expression;
        var prop = self.property;
        var terminated = trim_optional_chain(self, compressor);
        if (terminated) return terminated;
        if (compressor.option("properties")) {
            var key = prop.evaluate(compressor);
            if (key !== prop) {
                if (typeof key == "string") {
                    if (key == "undefined") {
                        key = undefined;
                    } else {
                        var value = parseFloat(key);
                        if (value.toString() == key) {
                            key = value;
                        }
                    }
                }
                prop = self.property = best_of_expression(prop, make_node_from_constant(key, prop).transform(compressor));
                var property = "" + key;
                if (is_identifier_string(property)
                    && property.length <= prop.print_to_string().length + 1) {
                    return make_node(AST_Dot, self, {
                        optional: self.optional,
                        expression: expr,
                        property: property,
                        quoted: true,
                    }).optimize(compressor);
                }
            }
        }
        var parent = compressor.parent();
        var assigned = is_lhs(compressor.self(), parent);
        var def, fn, fn_parent, index;
        if (compressor.option("arguments")
            && expr instanceof AST_SymbolRef
            && is_arguments(def = expr.definition())
            && !expr.in_arg
            && prop instanceof AST_Number
            && Math.floor(index = prop.value) == index
            && (fn = def.scope) === find_lambda()
            && fn.uses_arguments < (assigned ? 2 : 3)) {
            if (parent instanceof AST_UnaryPrefix && parent.operator == "delete") {
                if (!def.deleted) def.deleted = [];
                def.deleted[index] = true;
            }
            var argname = fn.argnames[index];
            if (def.deleted && def.deleted[index]) {
                argname = null;
            } else if (argname) {
                var arg_def;
                if (!(argname instanceof AST_SymbolFunarg)
                    || argname.name == "await"
                    || expr.scope.find_variable(argname.name) !== (arg_def = argname.definition())) {
                    argname = null;
                } else if (compressor.has_directive("use strict")
                    || fn.name
                    || fn.rest
                    || !(fn_parent instanceof AST_Call
                        && index < fn_parent.args.length
                        && all(fn_parent.args.slice(0, index + 1), function(arg) {
                            return !(arg instanceof AST_Spread);
                        }))
                    || !all(fn.argnames, function(argname) {
                        return argname instanceof AST_SymbolFunarg;
                    })) {
                    if (has_reassigned() || arg_def.assignments || arg_def.orig.length > 1) argname = null;
                }
            } else if ((assigned || !has_reassigned())
                && index < fn.argnames.length + 5
                && compressor.drop_fargs(fn, fn_parent)
                && !fn.rest) {
                while (index >= fn.argnames.length) {
                    argname = fn.make_var(AST_SymbolFunarg, fn, "argument_" + fn.argnames.length);
                    fn.argnames.push(argname);
                }
            }
            if (argname && find_if(function(node) {
                return node.name === argname.name;
            }, fn.argnames) === argname) {
                if (assigned) def.reassigned--;
                var sym = make_node(AST_SymbolRef, argname);
                sym.reference();
                argname.unused = undefined;
                return sym;
            }
        }
        if (assigned) return self;
        if (compressor.option("sequences")
            && parent.TYPE != "Call"
            && !(parent instanceof AST_ForEnumeration && parent.init === self)) {
            var seq = lift_sequence_in_expression(self, compressor);
            if (seq !== self) return seq.optimize(compressor);
        }
        if (key !== prop) {
            var sub = self.flatten_object(property, compressor);
            if (sub) {
                expr = self.expression = sub.expression;
                prop = self.property = sub.property;
            }
        }
        var elements;
        if (compressor.option("properties")
            && compressor.option("side_effects")
            && prop instanceof AST_Number
            && expr instanceof AST_Array
            && all(elements = expr.elements, function(value) {
                return !(value instanceof AST_Spread);
            })) {
            var index = prop.value;
            var retValue = elements[index];
            if (safe_to_flatten(retValue, compressor)) {
                var is_hole = retValue instanceof AST_Hole;
                var flatten = !is_hole;
                var values = [];
                for (var i = elements.length; --i > index;) {
                    var value = elements[i].drop_side_effect_free(compressor);
                    if (value) {
                        values.unshift(value);
                        if (flatten && value.has_side_effects(compressor)) flatten = false;
                    }
                }
                if (!flatten) values.unshift(retValue);
                while (--i >= 0) {
                    var value = elements[i].drop_side_effect_free(compressor);
                    if (value) {
                        values.unshift(value);
                    } else if (is_hole) {
                        values.unshift(make_node(AST_Hole, elements[i]));
                    } else {
                        index--;
                    }
                }
                if (flatten) {
                    values.push(retValue);
                    return make_sequence(self, values).optimize(compressor);
                }
                return make_node(AST_Sub, self, {
                    expression: make_node(AST_Array, expr, { elements: values }),
                    property: make_node(AST_Number, prop, { value: index }),
                });
            }
        }
        return try_evaluate(compressor, self);

        function find_lambda() {
            var i = 0, p;
            while (p = compressor.parent(i++)) {
                if (p instanceof AST_Lambda) {
                    if (p instanceof AST_Accessor) return;
                    if (is_arrow(p)) continue;
                    fn_parent = compressor.parent(i);
                    return p;
                }
            }
        }

        function has_reassigned() {
            return !compressor.option("reduce_vars") || def.reassigned;
        }
    });

    AST_LambdaExpression.DEFMETHOD("contains_super", function() {
        var result = false;
        var self = this;
        self.walk(new TreeWalker(function(node) {
            if (result) return true;
            if (node instanceof AST_Super) return result = true;
            if (node !== self && node instanceof AST_Scope && !is_arrow(node)) return true;
        }));
        return result;
    });

    // contains_this()
    // returns false only if context bound by the specified scope (or scope
    // containing the specified expression) is not referenced by `this`
    (function(def) {
        // scope of arrow function cannot bind to any context
        def(AST_Arrow, return_false);
        def(AST_AsyncArrow, return_false);
        def(AST_Node, function() {
            var result = false;
            var self = this;
            self.walk(new TreeWalker(function(node) {
                if (result) return true;
                if (node instanceof AST_This) return result = true;
                if (node !== self && node instanceof AST_Scope && !is_arrow(node)) return true;
            }));
            return result;
        });
    })(function(node, func) {
        node.DEFMETHOD("contains_this", func);
    });

    function can_hoist_property(prop) {
        return prop instanceof AST_ObjectKeyVal
            && typeof prop.key == "string"
            && !(prop instanceof AST_ObjectMethod && prop.value.contains_super());
    }

    AST_PropAccess.DEFMETHOD("flatten_object", function(key, compressor) {
        if (!compressor.option("properties")) return;
        if (key === "__proto__") return;
        var self = this;
        var expr = self.expression;
        if (!(expr instanceof AST_Object)) return;
        var props = expr.properties;
        for (var i = props.length; --i >= 0;) {
            var prop = props[i];
            if (prop.key !== key) continue;
            if (!all(props, can_hoist_property)) return;
            if (!safe_to_flatten(prop.value, compressor)) return;
            var call, scope, values = [];
            for (var j = 0; j < props.length; j++) {
                var value = props[j].value;
                if (props[j] instanceof AST_ObjectMethod) {
                    var arrow = !(value.uses_arguments || is_generator(value) || value.contains_this());
                    if (arrow) {
                        if (!scope) scope = compressor.find_parent(AST_Scope);
                        var avoid = avoid_await_yield(compressor, scope);
                        value.each_argname(function(argname) {
                            if (avoid[argname.name]) arrow = false;
                        });
                    }
                    var ctor;
                    if (arrow) {
                        ctor = is_async(value) ? AST_AsyncArrow : AST_Arrow;
                    } else if (i != j
                        || (call = compressor.parent()) instanceof AST_Call && call.expression === self) {
                        ctor = value.CTOR;
                    } else {
                        return;
                    }
                    value = make_node(ctor, value);
                }
                values.push(value);
            }
            return make_node(AST_Sub, self, {
                expression: make_node(AST_Array, expr, { elements: values }),
                property: make_node(AST_Number, self, { value: i }),
            });
        }
    });

    OPT(AST_Dot, function(self, compressor) {
        if (self.property == "arguments" || self.property == "caller") {
            AST_Node.warn("Function.prototype.{property} not supported [{start}]", self);
        }
        var parent = compressor.parent();
        if (is_lhs(compressor.self(), parent)) return self;
        var terminated = trim_optional_chain(self, compressor);
        if (terminated) return terminated;
        if (compressor.option("sequences")
            && parent.TYPE != "Call"
            && !(parent instanceof AST_ForEnumeration && parent.init === self)) {
            var seq = lift_sequence_in_expression(self, compressor);
            if (seq !== self) return seq.optimize(compressor);
        }
        if (compressor.option("unsafe_proto")
            && self.expression instanceof AST_Dot
            && self.expression.property == "prototype") {
            var exp = self.expression.expression;
            if (is_undeclared_ref(exp)) switch (exp.name) {
              case "Array":
                self.expression = make_node(AST_Array, self.expression, { elements: [] });
                break;
              case "Function":
                self.expression = make_node(AST_Function, self.expression, {
                    argnames: [],
                    body: [],
                }).init_vars(exp.scope);
                break;
              case "Number":
                self.expression = make_node(AST_Number, self.expression, { value: 0 });
                break;
              case "Object":
                self.expression = make_node(AST_Object, self.expression, { properties: [] });
                break;
              case "RegExp":
                self.expression = make_node(AST_RegExp, self.expression, { value: /t/ });
                break;
              case "String":
                self.expression = make_node(AST_String, self.expression, { value: "" });
                break;
            }
        }
        var sub = self.flatten_object(self.property, compressor);
        if (sub) return sub.optimize(compressor);
        return try_evaluate(compressor, self);
    });

    OPT(AST_DestructuredArray, function(self, compressor) {
        if (compressor.option("rests") && self.rest instanceof AST_DestructuredArray) {
            return make_node(AST_DestructuredArray, self, {
                elements: self.elements.concat(self.rest.elements),
                rest: self.rest.rest,
            });
        }
        return self;
    });

    OPT(AST_DestructuredKeyVal, function(self, compressor) {
        if (compressor.option("objects")) {
            var key = self.key;
            if (key instanceof AST_Node) {
                key = key.evaluate(compressor);
                if (key !== self.key) self.key = "" + key;
            }
        }
        return self;
    });

    OPT(AST_Object, function(self, compressor) {
        if (!compressor.option("objects")) return self;
        var changed = false;
        var found = false;
        var generated = false;
        var keep_duplicate = compressor.has_directive("use strict");
        var keys = [];
        var map = new Dictionary();
        var values = [];
        self.properties.forEach(function(prop) {
            if (!(prop instanceof AST_Spread)) return process(prop);
            found = true;
            var exp = prop.expression;
            if (compressor.option("spreads") && exp instanceof AST_Object && all(exp.properties, function(prop) {
                if (prop instanceof AST_ObjectGetter) return false;
                if (prop instanceof AST_Spread) return false;
                if (prop.key !== "__proto__") return true;
                if (prop instanceof AST_ObjectSetter) return true;
                return !prop.value.has_side_effects(compressor);
            })) {
                changed = true;
                exp.properties.forEach(function(prop) {
                    var key = prop.key;
                    var setter = prop instanceof AST_ObjectSetter;
                    if (key === "__proto__") {
                        if (!setter) return;
                        key = make_node_from_constant(key, prop);
                    }
                    process(setter ? make_node(AST_ObjectKeyVal, prop, {
                        key: key,
                        value: make_node(AST_Undefined, prop).optimize(compressor),
                    }) : prop);
                });
            } else {
                generated = true;
                flush();
                values.push(prop);
            }
        });
        flush();
        if (!changed) return self;
        if (found && generated && values.length == 1) {
            var value = values[0];
            if (value instanceof AST_ObjectProperty && value.key instanceof AST_Number) {
                value.key = "" + value.key.value;
            }
        }
        return make_node(AST_Object, self, { properties: values });

        function flush() {
            keys.forEach(function(key) {
                var props = map.get(key);
                switch (props.length) {
                  case 0:
                    return;
                  case 1:
                    return values.push(props[0]);
                }
                changed = true;
                var tail = keep_duplicate && !generated && props.pop();
                values.push(props.length == 1 ? props[0] : make_node(AST_ObjectKeyVal, self, {
                    key: props[0].key,
                    value: make_sequence(self, props.map(function(prop) {
                        return prop.value;
                    })),
                }));
                if (tail) values.push(tail);
                props.length = 0;
            });
            keys = [];
            map = new Dictionary();
        }

        function process(prop) {
            var key = prop.key;
            if (key instanceof AST_Node) {
                found = true;
                key = key.evaluate(compressor);
                if (key === prop.key || key === "__proto__") {
                    generated = true;
                } else {
                    key = prop.key = "" + key;
                }
            }
            if (can_hoist_property(prop)) {
                if (prop.value.has_side_effects(compressor)) flush();
                keys.push(key);
                map.add(key, prop);
            } else {
                flush();
                values.push(prop);
            }
            if (found && !generated && typeof key == "string" && RE_POSITIVE_INTEGER.test(key)) {
                generated = true;
                if (map.has(key)) prop = map.get(key)[0];
                prop.key = make_node(AST_Number, prop, { value: +key });
            }
        }
    });

    function flatten_var(name) {
        var redef = name.definition().redefined();
        if (redef) {
            name = name.clone();
            name.thedef = redef;
        }
        return name;
    }

    function has_arg_refs(fn, node) {
        var found = false;
        node.walk(new TreeWalker(function(node) {
            if (found) return true;
            if (node instanceof AST_SymbolRef && fn.variables.get(node.name) === node.definition()) {
                return found = true;
            }
        }));
        return found;
    }

    function insert_assign(def, assign) {
        var visited = [];
        def.references.forEach(function(ref) {
            var fixed = ref.fixed;
            if (!fixed || !push_uniq(visited, fixed)) return;
            if (fixed.assigns) {
                fixed.assigns.unshift(assign);
            } else {
                fixed.assigns = [ assign ];
            }
        });
    }

    function init_ref(compressor, name) {
        var sym = make_node(AST_SymbolRef, name);
        var assign = make_node(AST_Assign, name, {
            operator: "=",
            left: sym,
            right: make_node(AST_Undefined, name).transform(compressor),
        });
        var def = name.definition();
        if (def.fixed) {
            sym.fixed = function() {
                return assign.right;
            };
            sym.fixed.assigns = [ assign ];
            insert_assign(def, assign);
        }
        def.assignments++;
        def.references.push(sym);
        return assign;
    }

    (function(def) {
        def(AST_Node, noop);
        def(AST_Assign, noop);
        def(AST_Await, function(compressor, scope, no_return, in_loop) {
            if (!compressor.option("awaits")) return;
            var self = this;
            var inlined = self.expression.try_inline(compressor, scope, no_return, in_loop, true);
            if (!inlined) return;
            if (!no_return) scan_local_returns(inlined, function(node) {
                node.in_bool = false;
                var value = node.value;
                if (value instanceof AST_Await) return;
                node.value = make_node(AST_Await, self, {
                    expression: value || make_node(AST_Undefined, node).transform(compressor),
                });
            });
            return aborts(inlined) ? inlined : make_node(AST_BlockStatement, self, {
                body: [ inlined, make_node(AST_SimpleStatement, self, {
                    body: make_node(AST_Await, self, { expression: make_node(AST_Number, self, { value: 0 })}),
                }) ],
            });
        });
        def(AST_Binary, function(compressor, scope, no_return, in_loop, in_await) {
            if (no_return === undefined) return;
            var self = this;
            var op = self.operator;
            if (!lazy_op[op]) return;
            var inlined = self.right.try_inline(compressor, scope, no_return, in_loop, in_await);
            if (!inlined) return;
            return make_node(AST_If, self, {
                condition: make_condition(self.left),
                body: inlined,
                alternative: no_return ? null : make_node(AST_Return, self, {
                    value: make_node(AST_Undefined, self).transform(compressor),
                }),
            });

            function make_condition(cond) {
                switch (op) {
                  case "&&":
                    return cond;
                  case "||":
                    return cond.negate(compressor);
                  case "??":
                    return make_node(AST_Binary, self, {
                        operator: "==",
                        left: make_node(AST_Null, self),
                        right: cond,
                    });
                }
            }
        });
        def(AST_BlockStatement, function(compressor, scope, no_return, in_loop) {
            if (no_return) return;
            if (!this.variables) return;
            var body = this.body;
            var last = body.length - 1;
            if (last < 0) return;
            var inlined = body[last].try_inline(compressor, this, no_return, in_loop);
            if (!inlined) return;
            body[last] = inlined;
            return this;
        });
        def(AST_Call, function(compressor, scope, no_return, in_loop, in_await) {
            if (compressor.option("inline") < 4) return;
            var call = this;
            if (call.is_expr_pure(compressor)) return;
            var fn = call.expression;
            if (!(fn instanceof AST_LambdaExpression)) return;
            if (fn.name) return;
            if (fn.uses_arguments) return;
            if (fn.pinned()) return;
            if (is_generator(fn)) return;
            var arrow = is_arrow(fn);
            if (arrow && fn.value) return;
            if (fn.body[0] instanceof AST_Directive) return;
            if (fn.contains_this()) return;
            if (!scope) scope = find_scope(compressor);
            var defined = new Dictionary();
            defined.set("NaN", true);
            while (!(scope instanceof AST_Scope)) {
                scope.variables.each(function(def) {
                    defined.set(def.name, true);
                });
                scope = scope.parent_scope;
            }
            if (!member(scope, compressor.stack)) return;
            if (scope.pinned() && fn.variables.size() > (arrow ? 0 : 1)) return;
            if (scope instanceof AST_Toplevel) {
                if (fn.variables.size() > (arrow ? 0 : 1)) {
                    if (!compressor.toplevel.vars) return;
                    if (fn.functions.size() > 0 && !compressor.toplevel.funcs) return;
                }
                defined.set("arguments", true);
            }
            var async = !in_await && is_async(fn);
            if (async) {
                if (!compressor.option("awaits")) return;
                if (!is_async(scope)) return;
                if (call.may_throw(compressor)) return;
            }
            var names = scope.var_names();
            if (in_loop) in_loop = [];
            if (!fn.variables.all(function(def, name) {
                if (in_loop) in_loop.push(def);
                if (!defined.has(name) && !names.has(name)) return true;
                return !arrow && name == "arguments" && def.orig.length == 1;
            })) return;
            if (in_loop && in_loop.length > 0 && is_reachable(fn, in_loop)) return;
            var simple_argnames = true;
            if (!all(fn.argnames, function(argname) {
                var abort = false;
                var tw = new TreeWalker(function(node) {
                    if (abort) return true;
                    if (node instanceof AST_DefaultValue) {
                        if (has_arg_refs(fn, node.value)) return abort = true;
                        node.name.walk(tw);
                        return true;
                    }
                    if (node instanceof AST_DestructuredKeyVal) {
                        if (node.key instanceof AST_Node && has_arg_refs(fn, node.key)) return abort = true;
                        node.value.walk(tw);
                        return true;
                    }
                    if (node instanceof AST_SymbolFunarg && !all(node.definition().orig, function(sym) {
                        return !(sym instanceof AST_SymbolDefun);
                    })) return abort = true;
                });
                argname.walk(tw);
                if (abort) return false;
                if (!(argname instanceof AST_SymbolFunarg)) simple_argnames = false;
                return true;
            })) return;
            if (fn.rest) {
                if (has_arg_refs(fn, fn.rest)) return;
                simple_argnames = false;
            }
            var verify_body;
            if (no_return) {
                verify_body = function(stat) {
                    var abort = false;
                    stat.walk(new TreeWalker(function(node) {
                        if (abort) return true;
                        if (async && (node instanceof AST_Await || node instanceof AST_ForAwaitOf)
                            || node instanceof AST_Return) {
                            return abort = true;
                        }
                        if (node instanceof AST_Scope) return true;
                    }));
                    return !abort;
                };
            } else if (in_await || is_async(fn) || in_async_generator(scope)) {
                verify_body = function(stat) {
                    var abort = false;
                    var find_return = new TreeWalker(function(node) {
                        if (abort) return true;
                        if (node instanceof AST_Return) return abort = true;
                        if (node instanceof AST_Scope) return true;
                    });
                    stat.walk(new TreeWalker(function(node) {
                        if (abort) return true;
                        if (node instanceof AST_Try) {
                            if (node.bfinally && all(node.body, function(stat) {
                                stat.walk(find_return);
                                return !abort;
                            }) && node.bcatch) node.bcatch.walk(find_return);
                            return true;
                        }
                        if (node instanceof AST_Scope) return true;
                    }));
                    return !abort;
                };
            }
            if (verify_body && !all(fn.body, verify_body)) return;
            if (!safe_from_await_yield(fn, avoid_await_yield(compressor, scope))) return;
            fn.functions.each(function(def, name) {
                scope.functions.set(name, def);
            });
            var body = [];
            fn.variables.each(function(def, name) {
                if (!arrow && name == "arguments" && def.orig.length == 1) return;
                names.set(name, true);
                scope.enclosed.push(def);
                scope.variables.set(name, def);
                def.single_use = false;
                if (!in_loop) return;
                if (def.references.length == def.replaced) return;
                if (def.orig.length == def.eliminated) return;
                if (def.orig.length == 1 && fn.functions.has(name)) return;
                if (!all(def.orig, function(sym) {
                    if (sym instanceof AST_SymbolConst) return false;
                    if (sym instanceof AST_SymbolFunarg) return !sym.unused && def.scope.resolve() !== fn;
                    if (sym instanceof AST_SymbolLet) return false;
                    return true;
                })) return;
                var sym = def.orig[0];
                if (sym instanceof AST_SymbolCatch) return;
                body.push(make_node(AST_SimpleStatement, sym, { body: init_ref(compressor, flatten_var(sym)) }));
            });
            var defs = Object.create(null), syms = new Dictionary();
            if (simple_argnames && all(call.args, function(arg) {
                return !(arg instanceof AST_Spread);
            })) {
                var values = call.args.slice();
                fn.argnames.forEach(function(argname) {
                    var value = values.shift();
                    if (argname.unused) {
                        if (value) body.push(make_node(AST_SimpleStatement, call, { body: value }));
                        return;
                    }
                    var defn = make_node(AST_VarDef, call, {
                        name: argname.convert_symbol(AST_SymbolVar, process),
                        value: value || make_node(AST_Undefined, call).transform(compressor),
                    });
                    if (argname instanceof AST_SymbolFunarg) insert_assign(argname.definition(), defn);
                    body.push(make_node(AST_Var, call, { definitions: [ defn ] }));
                });
                if (values.length) body.push(make_node(AST_SimpleStatement, call, {
                    body: make_sequence(call, values),
                }));
            } else {
                body.push(make_node(AST_Var, call, {
                    definitions: [ make_node(AST_VarDef, call, {
                        name: make_node(AST_DestructuredArray, call, {
                            elements: fn.argnames.map(function(argname) {
                                if (argname.unused) return make_node(AST_Hole, argname);
                                return argname.convert_symbol(AST_SymbolVar, process);
                            }),
                            rest: fn.rest && fn.rest.convert_symbol(AST_SymbolVar, process),
                        }),
                        value: make_node(AST_Array, call, { elements: call.args.slice() }),
                    }) ],
                }));
            }
            syms.each(function(orig, id) {
                var def = defs[id];
                [].unshift.apply(def.orig, orig);
                def.eliminated += orig.length;
            });
            [].push.apply(body, in_loop ? fn.body.filter(function(stat) {
                if (!(stat instanceof AST_LambdaDefinition)) return true;
                var name = make_node(AST_SymbolVar, flatten_var(stat.name));
                var def = name.definition();
                def.fixed = false;
                def.orig.push(name);
                def.eliminated++;
                body.push(make_node(AST_Var, stat, {
                    definitions: [ make_node(AST_VarDef, stat, {
                        name: name,
                        value: to_func_expr(stat, true),
                    }) ],
                }));
                return false;
            }) : fn.body);
            var inlined = make_node(AST_BlockStatement, call, { body: body });
            if (!no_return) {
                if (async) scan_local_returns(inlined, function(node) {
                    var value = node.value;
                    if (is_undefined(value)) return;
                    node.value = make_node(AST_Await, call, { expression: value });
                });
                body.push(make_node(AST_Return, call, {
                    value: in_async_generator(scope) ? make_node(AST_Undefined, call).transform(compressor) : null,
                }));
            }
            return inlined;

            function process(sym, argname) {
                var def = argname.definition();
                defs[def.id] = def;
                syms.add(def.id, sym);
            }
        });
        def(AST_Conditional, function(compressor, scope, no_return, in_loop, in_await) {
            var self = this;
            var body = self.consequent.try_inline(compressor, scope, no_return, in_loop, in_await);
            var alt = self.alternative.try_inline(compressor, scope, no_return, in_loop, in_await);
            if (!body && !alt) return;
            return make_node(AST_If, self, {
                condition: self.condition,
                body: body || make_body(self.consequent),
                alternative: alt || make_body(self.alternative),
            });

            function make_body(value) {
                if (no_return) return make_node(AST_SimpleStatement, value, { body: value });
                return make_node(AST_Return, value, { value: value });
            }
        });
        def(AST_For, function(compressor, scope, no_return, in_loop) {
            var body = this.body.try_inline(compressor, scope, true, true);
            if (body) this.body = body;
            var inlined = this.init;
            if (inlined) {
                inlined = inlined.try_inline(compressor, scope, true, in_loop);
                if (inlined) {
                    this.init = null;
                    if (inlined instanceof AST_BlockStatement) {
                        inlined.body.push(this);
                        return inlined;
                    }
                    return make_node(AST_BlockStatement, inlined, { body: [ inlined, this ] });
                }
            }
            return body && this;
        });
        def(AST_ForEnumeration, function(compressor, scope, no_return, in_loop) {
            var body = this.body.try_inline(compressor, scope, true, true);
            if (body) this.body = body;
            var obj = this.object;
            if (obj instanceof AST_Sequence) {
                var inlined = inline_sequence(compressor, scope, true, in_loop, false, obj, 1);
                if (inlined) {
                    this.object = obj.tail_node();
                    inlined.body.push(this);
                    return inlined;
                }
            }
            return body && this;
        });
        def(AST_If, function(compressor, scope, no_return, in_loop) {
            var body = this.body.try_inline(compressor, scope, no_return, in_loop);
            if (body) this.body = body;
            var alt = this.alternative;
            if (alt) {
                alt = alt.try_inline(compressor, scope, no_return, in_loop);
                if (alt) this.alternative = alt;
            }
            var cond = this.condition;
            if (cond instanceof AST_Sequence) {
                var inlined = inline_sequence(compressor, scope, true, in_loop, false, cond, 1);
                if (inlined) {
                    this.condition = cond.tail_node();
                    inlined.body.push(this);
                    return inlined;
                }
            }
            return (body || alt) && this;
        });
        def(AST_IterationStatement, function(compressor, scope, no_return, in_loop) {
            var body = this.body.try_inline(compressor, scope, true, true);
            if (!body) return;
            this.body = body;
            return this;
        });
        def(AST_LabeledStatement, function(compressor, scope, no_return, in_loop) {
            var body = this.body.try_inline(compressor, scope, no_return, in_loop);
            if (!body) return;
            if (this.body instanceof AST_IterationStatement && body instanceof AST_BlockStatement) {
                var loop = body.body.pop();
                this.body = loop;
                body.body.push(this);
                return body;
            }
            this.body = body;
            return this;
        });
        def(AST_New, noop);
        def(AST_Return, function(compressor, scope, no_return, in_loop) {
            var value = this.value;
            return value && value.try_inline(compressor, scope, undefined, in_loop === "try");
        });
        function inline_sequence(compressor, scope, no_return, in_loop, in_await, node, skip) {
            var body = [], exprs = node.expressions, no_ret = no_return;
            for (var i = exprs.length - (skip || 0), j = i; --i >= 0; no_ret = true, in_await = false) {
                var inlined = exprs[i].try_inline(compressor, scope, no_ret, in_loop, in_await);
                if (!inlined) continue;
                flush();
                body.push(inlined);
            }
            if (body.length == 0) return;
            flush();
            if (!no_return && body[0] instanceof AST_SimpleStatement) {
                body[0] = make_node(AST_Return, node, { value: body[0].body });
            }
            return make_node(AST_BlockStatement, node, { body: body.reverse() });

            function flush() {
                if (j > i + 1) body.push(make_node(AST_SimpleStatement, node, {
                    body: make_sequence(node, exprs.slice(i + 1, j)),
                }));
                j = i;
            }
        }
        def(AST_Sequence, function(compressor, scope, no_return, in_loop, in_await) {
            return inline_sequence(compressor, scope, no_return, in_loop, in_await, this);
        });
        def(AST_SimpleStatement, function(compressor, scope, no_return, in_loop) {
            var body = this.body;
            while (body instanceof AST_UnaryPrefix) {
                var op = body.operator;
                if (unary_side_effects[op]) break;
                if (op == "void") break;
                body = body.expression;
            }
            if (!no_return && !is_undefined(body)) body = make_node(AST_UnaryPrefix, this, {
                operator: "void",
                expression: body,
            });
            return body.try_inline(compressor, scope, no_return || false, in_loop);
        });
        def(AST_UnaryPrefix, function(compressor, scope, no_return, in_loop, in_await) {
            var self = this;
            var op = self.operator;
            if (unary_side_effects[op]) return;
            if (!no_return && op == "void") no_return = false;
            var inlined = self.expression.try_inline(compressor, scope, no_return, in_loop, in_await);
            if (!inlined) return;
            if (!no_return) scan_local_returns(inlined, function(node) {
                node.in_bool = false;
                var value = node.value;
                if (op == "void" && is_undefined(value)) return;
                node.value = make_node(AST_UnaryPrefix, self, {
                    operator: op,
                    expression: value || make_node(AST_Undefined, node).transform(compressor),
                });
            });
            return inlined;
        });
        def(AST_With, function(compressor, scope, no_return, in_loop) {
            var body = this.body.try_inline(compressor, scope, no_return, in_loop);
            if (body) this.body = body;
            var exp = this.expression;
            if (exp instanceof AST_Sequence) {
                var inlined = inline_sequence(compressor, scope, true, in_loop, false, exp, 1);
                if (inlined) {
                    this.expression = exp.tail_node();
                    inlined.body.push(this);
                    return inlined;
                }
            }
            return body && this;
        });
        def(AST_Yield, function(compressor, scope, no_return, in_loop) {
            if (!compressor.option("yields")) return;
            if (!this.nested) return;
            var call = this.expression;
            if (call.TYPE != "Call") return;
            var fn = call.expression;
            switch (fn.CTOR) {
              case AST_AsyncGeneratorFunction:
                fn = make_node(AST_AsyncFunction, fn);
                break;
              case AST_GeneratorFunction:
                fn = make_node(AST_Function, fn);
                break;
              default:
                return;
            }
            call = call.clone();
            call.expression = fn;
            return call.try_inline(compressor, scope, no_return, in_loop);
        });
    })(function(node, func) {
        node.DEFMETHOD("try_inline", func);
    });

    OPT(AST_Return, function(self, compressor) {
        var value = self.value;
        if (value && compressor.option("side_effects")
            && is_undefined(value, compressor)
            && !in_async_generator(compressor.find_parent(AST_Scope))) {
            self.value = null;
        }
        return self;
    });
})(function(node, optimizer) {
    node.DEFMETHOD("optimize", function(compressor) {
        var self = this;
        if (self._optimized) return self;
        if (compressor.has_directive("use asm")) return self;
        var opt = optimizer(self, compressor);
        opt._optimized = true;
        return opt;
    });
});


/***********************************************************************

  A JavaScript tokenizer / parser / beautifier / compressor.
  https://github.com/mishoo/UglifyJS

  -------------------------------- (C) ---------------------------------

                           Author: Mihai Bazon
                         <mihai.bazon@gmail.com>
                       http://mihai.bazon.net/blog

  Distributed under the BSD license:

    Copyright 2012 (c) Mihai Bazon <mihai.bazon@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:

        * Redistributions of source code must retain the above
          copyright notice, this list of conditions and the following
          disclaimer.

        * Redistributions in binary form must reproduce the above
          copyright notice, this list of conditions and the following
          disclaimer in the documentation and/or other materials
          provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
    EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
    PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
    OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
    PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
    PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
    TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
    THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
    SUCH DAMAGE.

 ***********************************************************************/

"use strict";

function is_some_comments(comment) {
    // multiline comment
    return comment.type == "comment2" && /@preserve|@license|@cc_on/i.test(comment.value);
}

function OutputStream(options) {
    options = defaults(options, {
        annotations      : false,
        ascii_only       : false,
        beautify         : false,
        braces           : false,
        comments         : false,
        extendscript     : false,
        galio            : false,
        ie               : false,
        indent_level     : 4,
        indent_start     : 0,
        inline_script    : true,
        keep_quoted_props: false,
        max_line_len     : false,
        preamble         : null,
        preserve_line    : false,
        quote_keys       : false,
        quote_style      : 0,
        semicolons       : true,
        shebang          : true,
        source_map       : null,
        v8               : false,
        webkit           : false,
        width            : 80,
        wrap_iife        : false,
    }, true);

    // Convert comment option to RegExp if necessary and set up comments filter
    var comment_filter = return_false; // Default case, throw all comments away
    if (options.comments) {
        var comments = options.comments;
        if (typeof options.comments === "string" && /^\/.*\/[a-zA-Z]*$/.test(options.comments)) {
            var regex_pos = options.comments.lastIndexOf("/");
            comments = new RegExp(
                options.comments.substr(1, regex_pos - 1),
                options.comments.substr(regex_pos + 1)
            );
        }
        if (comments instanceof RegExp) {
            comment_filter = function(comment) {
                return comment.type != "comment5" && comments.test(comment.value);
            };
        } else if (typeof comments === "function") {
            comment_filter = function(comment) {
                return comment.type != "comment5" && comments(this, comment);
            };
        } else if (comments === "some") {
            comment_filter = is_some_comments;
        } else { // NOTE includes "all" option
            comment_filter = return_true;
        }
    }

    function make_indent(value) {
        if (typeof value == "number") return new Array(value + 1).join(" ");
        if (!value) return "";
        if (!/^\s*$/.test(value)) throw new Error("unsupported indentation: " + JSON.stringify("" + value));
        return value;
    }

    var current_col = 0;
    var current_line = 1;
    var current_indent = make_indent(options.indent_start);
    var full_indent = make_indent(options.indent_level);
    var half_indent = full_indent.length + 1 >> 1;
    var last;
    var line_end = 0;
    var line_fixed = true;
    var mappings = options.source_map && [];
    var mapping_name;
    var mapping_token;
    var might_need_space;
    var might_need_semicolon;
    var need_newline_indented = false;
    var need_space = false;
    var output;
    var stack;
    var stored = "";

    function reset() {
        last = "";
        might_need_space = false;
        might_need_semicolon = false;
        stack = [];
        var str = output;
        output = "";
        return str;
    }

    reset();
    var to_utf8 = options.ascii_only ? function(str, identifier) {
        if (identifier) str = str.replace(/[\ud800-\udbff][\udc00-\udfff]/g, function(ch) {
            return "\\u{" + (ch.charCodeAt(0) - 0xd7c0 << 10 | ch.charCodeAt(1) - 0xdc00).toString(16) + "}";
        });
        return str.replace(/[\u0000-\u001f\u007f-\uffff]/g, function(ch) {
            var code = ch.charCodeAt(0).toString(16);
            if (code.length <= 2 && !identifier) {
                while (code.length < 2) code = "0" + code;
                return "\\x" + code;
            } else {
                while (code.length < 4) code = "0" + code;
                return "\\u" + code;
            }
        });
    } : function(str) {
        var s = "";
        for (var i = 0, j = 0; i < str.length; i++) {
            var code = str.charCodeAt(i);
            if (is_surrogate_pair_head(code)) {
                if (is_surrogate_pair_tail(str.charCodeAt(i + 1))) {
                    i++;
                    continue;
                }
            } else if (!is_surrogate_pair_tail(code)) {
                continue;
            }
            s += str.slice(j, i) + "\\u" + code.toString(16);
            j = i + 1;
        }
        return j == 0 ? str : s + str.slice(j);
    };

    function quote_single(str) {
        return "'" + str.replace(/\x27/g, "\\'") + "'";
    }

    function quote_double(str) {
        return '"' + str.replace(/\x22/g, '\\"') + '"';
    }

    var quote_string = [
        null,
        quote_single,
        quote_double,
        function(str, quote) {
            return quote == "'" ? quote_single(str) : quote_double(str);
        },
    ][options.quote_style] || function(str, quote, dq, sq) {
        return dq > sq ? quote_single(str) : quote_double(str);
    };

    function make_string(str, quote) {
        var dq = 0, sq = 0;
        str = str.replace(/[\\\b\f\n\r\v\t\x22\x27\u2028\u2029\0\ufeff]/g, function(s, i) {
            switch (s) {
              case '"': ++dq; return '"';
              case "'": ++sq; return "'";
              case "\\": return "\\\\";
              case "\n": return "\\n";
              case "\r": return "\\r";
              case "\t": return "\\t";
              case "\b": return "\\b";
              case "\f": return "\\f";
              case "\x0B": return options.ie ? "\\x0B" : "\\v";
              case "\u2028": return "\\u2028";
              case "\u2029": return "\\u2029";
              case "\ufeff": return "\\ufeff";
              case "\0":
                  return /[0-9]/.test(str.charAt(i+1)) ? "\\x00" : "\\0";
            }
            return s;
        });
        return quote_string(to_utf8(str), quote, dq, sq);
    }

    /* -----[ beautification/minification ]----- */

    var adjust_mappings = mappings ? function(line, col) {
        mappings.forEach(function(mapping) {
            mapping.line += line;
            mapping.col += col;
        });
    } : noop;

    var flush_mappings = mappings ? function() {
        mappings.forEach(function(mapping) {
            options.source_map.add(
                mapping.token.file,
                mapping.line, mapping.col,
                mapping.token.line, mapping.token.col,
                !mapping.name && mapping.token.type == "name" ? mapping.token.value : mapping.name
            );
        });
        mappings = [];
    } : noop;

    function insert_newlines(count) {
        stored += output.slice(0, line_end);
        output = output.slice(line_end);
        var new_col = output.length;
        adjust_mappings(count, new_col - current_col);
        current_line += count;
        current_col = new_col;
        while (count--) stored += "\n";
    }

    var fix_line = options.max_line_len ? function(flush) {
        if (line_fixed) {
            if (current_col > options.max_line_len) {
                AST_Node.warn("Output exceeds {max_line_len} characters", options);
            }
            return;
        }
        if (current_col > options.max_line_len) {
            insert_newlines(1);
            line_fixed = true;
        }
        if (line_fixed || flush) flush_mappings();
    } : noop;

    var require_semicolon = makePredicate("( [ + * / - , .");

    function require_space(prev, ch, str) {
        return is_identifier_char(prev) && (is_identifier_char(ch) || ch == "\\")
            || (ch == "/" && ch == prev)
            || ((ch == "+" || ch == "-") && ch == last)
            || last == "--" && ch == ">"
            || last == "!" && str == "--"
            || prev == "/" && (str == "in" || str == "instanceof");
    }

    var print = options.beautify
        || options.comments
        || options.max_line_len
        || options.preserve_line
        || options.shebang
        || !options.semicolons
        || options.source_map
        || options.width ? function(str) {
        var ch = str.charAt(0);
        if (need_newline_indented && ch) {
            need_newline_indented = false;
            if (ch != "\n") {
                print("\n");
                indent();
            }
        }
        if (need_space && ch) {
            need_space = false;
            if (!/[\s;})]/.test(ch)) {
                space();
            }
        }
        var prev = last.slice(-1);
        if (might_need_semicolon) {
            might_need_semicolon = false;
            if (prev == ":" && ch == "}" || prev != ";" && (!ch || ";}".indexOf(ch) < 0)) {
                var need_semicolon = require_semicolon[ch];
                if (need_semicolon || options.semicolons) {
                    output += ";";
                    current_col++;
                    if (!line_fixed) {
                        fix_line();
                        if (line_fixed && !need_semicolon && output == ";") {
                            output = "";
                            current_col = 0;
                        }
                    }
                    if (line_end == output.length - 1) line_end++;
                } else {
                    fix_line();
                    output += "\n";
                    current_line++;
                    current_col = 0;
                    // reset the semicolon flag, since we didn't print one
                    // now and might still have to later
                    if (/^\s+$/.test(str)) might_need_semicolon = true;
                }
                if (!options.beautify) might_need_space = false;
            }
        }

        if (might_need_space) {
            if (require_space(prev, ch, str)) {
                output += " ";
                current_col++;
            }
            if (prev != "<" || str != "!") might_need_space = false;
        }

        if (mapping_token) {
            mappings.push({
                token: mapping_token,
                name: mapping_name,
                line: current_line,
                col: current_col,
            });
            mapping_token = false;
            if (line_fixed) flush_mappings();
        }

        output += str;
        var a = str.split(/\r?\n/), n = a.length - 1;
        current_line += n;
        current_col += a[0].length;
        if (n > 0) {
            fix_line();
            current_col = a[n].length;
        }
        last = str;
    } : function(str) {
        var ch = str.charAt(0);
        var prev = last.slice(-1);
        if (might_need_semicolon) {
            might_need_semicolon = false;
            if (prev == ":" && ch == "}" || (!ch || ";}".indexOf(ch) < 0) && prev != ";") {
                output += ";";
                might_need_space = false;
            }
        }
        if (might_need_space) {
            if (require_space(prev, ch, str)) output += " ";
            if (prev != "<" || str != "!") might_need_space = false;
        }
        output += str;
        last = str;
    };

    var space = options.beautify ? function() {
        print(" ");
    } : function() {
        might_need_space = true;
    };

    var indent = options.beautify ? function(half) {
        if (need_newline_indented) print("\n");
        print(half ? current_indent.slice(0, -half_indent) : current_indent);
    } : noop;

    var with_indent = options.beautify ? function(cont) {
        var save_indentation = current_indent;
        current_indent += full_indent;
        cont();
        current_indent = save_indentation;
    } : function(cont) { cont() };

    var may_add_newline = options.max_line_len || options.preserve_line ? function() {
        fix_line();
        line_end = output.length;
        line_fixed = false;
    } : noop;

    var newline = options.beautify ? function() {
        print("\n");
        line_end = output.length;
    } : may_add_newline;

    var semicolon = options.beautify ? function() {
        print(";");
    } : function() {
        might_need_semicolon = true;
    };

    function force_semicolon() {
        if (might_need_semicolon) print(";");
        print(";");
    }

    function with_block(cont, end) {
        print("{");
        newline();
        with_indent(cont);
        add_mapping(end);
        indent();
        print("}");
    }

    function with_parens(cont) {
        print("(");
        may_add_newline();
        cont();
        may_add_newline();
        print(")");
    }

    function with_square(cont) {
        print("[");
        may_add_newline();
        cont();
        may_add_newline();
        print("]");
    }

    function comma() {
        may_add_newline();
        print(",");
        may_add_newline();
        space();
    }

    function colon() {
        print(":");
        space();
    }

    var add_mapping = mappings ? function(token, name) {
        mapping_token = token;
        mapping_name = name;
    } : noop;

    function get() {
        if (!line_fixed) fix_line(true);
        return stored + output;
    }

    function has_nlb() {
        return /(^|\n) *$/.test(output);
    }

    function pad_comment(token, force) {
        if (need_newline_indented) return;
        if (token.nlb && (force || !has_nlb())) {
            need_newline_indented = true;
        } else if (force) {
            need_space = true;
        }
    }

    function print_comment(comment) {
        var value = comment.value.replace(/[@#]__PURE__/g, " ");
        if (/^\s*$/.test(value) && !/^\s*$/.test(comment.value)) return false;
        if (/comment[134]/.test(comment.type)) {
            print("//" + value);
            need_newline_indented = true;
        } else if (comment.type == "comment2") {
            print("/*" + value + "*/");
        }
        return true;
    }

    function should_merge_comments(node, parent) {
        if (parent instanceof AST_Binary) return parent.left === node;
        if (parent.TYPE == "Call") return parent.expression === node;
        if (parent instanceof AST_Conditional) return parent.condition === node;
        if (parent instanceof AST_Dot) return parent.expression === node;
        if (parent instanceof AST_Exit) return true;
        if (parent instanceof AST_Sequence) return parent.expressions[0] === node;
        if (parent instanceof AST_Sub) return parent.expression === node;
        if (parent instanceof AST_UnaryPostfix) return true;
        if (parent instanceof AST_Yield) return true;
    }

    function prepend_comments(node) {
        var self = this;
        var scan;
        if (node instanceof AST_Exit) {
            scan = node.value;
        } else if (node instanceof AST_Yield) {
            scan = node.expression;
        }
        var comments = dump(node);
        if (!comments) comments = [];

        if (scan) {
            var tw = new TreeWalker(function(node) {
                if (!should_merge_comments(node, tw.parent())) return true;
                var before = dump(node);
                if (before) comments = comments.concat(before);
            });
            tw.push(node);
            scan.walk(tw);
        }

        if (current_line == 1 && current_col == 0) {
            if (comments.length > 0 && options.shebang && comments[0].type == "comment5") {
                print("#!" + comments.shift().value + "\n");
                indent();
            }
            var preamble = options.preamble;
            if (preamble) print(preamble.replace(/\r\n?|\u2028|\u2029|(^|\S)\s*$/g, "$1\n"));
        }

        comments = comments.filter(comment_filter, node);
        var printed = false;
        comments.forEach(function(comment, index) {
            pad_comment(comment, index);
            if (print_comment(comment)) printed = true;
        });
        if (printed) pad_comment(node.start, true);

        function dump(node) {
            var token = node.start;
            if (!token) {
                if (!scan) return;
                node.start = token = new AST_Token();
            }
            var comments = token.comments_before;
            if (!comments) {
                if (!scan) return;
                token.comments_before = comments = [];
            }
            if (comments._dumped === self) return;
            comments._dumped = self;
            return comments;
        }
    }

    function append_comments(node, tail) {
        var self = this;
        var token = node.end;
        if (!token) return;
        var comments = token[tail ? "comments_before" : "comments_after"];
        if (!comments || comments._dumped === self) return;
        if (!(node instanceof AST_Statement || all(comments, function(c) {
            return !/comment[134]/.test(c.type);
        }))) return;
        comments._dumped = self;
        comments.filter(comment_filter, node).forEach(function(comment, index) {
            pad_comment(comment, index || !tail);
            print_comment(comment);
        });
    }

    return {
        get             : get,
        reset           : reset,
        indent          : indent,
        should_break    : options.beautify && options.width ? function() {
            return current_col >= options.width;
        } : return_false,
        has_parens      : function() { return last.slice(-1) == "(" },
        newline         : newline,
        print           : print,
        space           : space,
        comma           : comma,
        colon           : colon,
        last            : function() { return last },
        semicolon       : semicolon,
        force_semicolon : force_semicolon,
        to_utf8         : to_utf8,
        print_name      : function(name) { print(to_utf8(name.toString(), true)) },
        print_string    : options.inline_script ? function(str, quote) {
            str = make_string(str, quote).replace(/<\x2f(script)([>\/\t\n\f\r ])/gi, "<\\/$1$2");
            print(str.replace(/\x3c!--/g, "\\x3c!--").replace(/--\x3e/g, "--\\x3e"));
        } : function(str, quote) {
            print(make_string(str, quote));
        },
        with_indent     : with_indent,
        with_block      : with_block,
        with_parens     : with_parens,
        with_square     : with_square,
        add_mapping     : add_mapping,
        option          : function(opt) { return options[opt] },
        prepend_comments: options.comments || options.shebang ? prepend_comments : noop,
        append_comments : options.comments ? append_comments : noop,
        push_node       : function(node) { stack.push(node) },
        pop_node        : options.preserve_line ? function() {
            var node = stack.pop();
            if (node.start && node.start.line > current_line) {
                insert_newlines(node.start.line - current_line);
            }
        } : function() {
            stack.pop();
        },
        parent          : function(n) {
            return stack[stack.length - 2 - (n || 0)];
        },
    };
}

/* -----[ code generators ]----- */

(function() {

    /* -----[ utils ]----- */

    function DEFPRINT(nodetype, generator) {
        nodetype.DEFMETHOD("_codegen", generator);
    }

    var use_asm = false;

    AST_Node.DEFMETHOD("print", function(stream, force_parens) {
        var self = this;
        stream.push_node(self);
        if (force_parens || self.needs_parens(stream)) {
            stream.with_parens(doit);
        } else {
            doit();
        }
        stream.pop_node();

        function doit() {
            stream.prepend_comments(self);
            self.add_source_map(stream);
            self._codegen(stream);
            stream.append_comments(self);
        }
    });
    var readonly = OutputStream({
        inline_script: false,
        shebang: false,
        width: false,
    });
    AST_Node.DEFMETHOD("print_to_string", function(options) {
        if (options) {
            var stream = OutputStream(options);
            this.print(stream);
            return stream.get();
        }
        this.print(readonly);
        return readonly.reset();
    });

    /* -----[ PARENTHESES ]----- */

    function PARENS(nodetype, func) {
        nodetype.DEFMETHOD("needs_parens", func);
    }

    PARENS(AST_Node, return_false);

    // a function expression needs parens around it when it's provably
    // the first token to appear in a statement.
    function needs_parens_function(output) {
        var p = output.parent();
        if (!output.has_parens() && first_in_statement(output, false, true)) {
            // export default function() {}
            // export default (function foo() {});
            // export default (function() {})(foo);
            // export default (function() {})`foo`;
            // export default (function() {}) ? foo : bar;
            return this.name || !(p instanceof AST_ExportDefault);
        }
        if (output.option("webkit") && p instanceof AST_PropAccess && p.expression === this) return true;
        if (output.option("wrap_iife") && p instanceof AST_Call && p.expression === this) return true;
    }
    PARENS(AST_AsyncFunction, needs_parens_function);
    PARENS(AST_AsyncGeneratorFunction, needs_parens_function);
    PARENS(AST_ClassExpression, needs_parens_function);
    PARENS(AST_Function, needs_parens_function);
    PARENS(AST_GeneratorFunction, needs_parens_function);

    // same goes for an object literal, because otherwise it would be
    // interpreted as a block of code.
    function needs_parens_obj(output) {
        return !output.has_parens() && first_in_statement(output, true);
    }
    PARENS(AST_Object, needs_parens_obj);

    function needs_parens_unary(output) {
        var p = output.parent();
        // (-x) ** y
        if (p instanceof AST_Binary) return p.operator == "**" && p.left === this;
        // (await x)(y)
        // new (await x)
        if (p instanceof AST_Call) return p.expression === this;
        // class extends (x++) {}
        // class x extends (typeof y) {}
        if (p instanceof AST_Class) return true;
        // (x++)[y]
        // (typeof x).y
        // https://github.com/mishoo/UglifyJS/issues/115
        if (p instanceof AST_PropAccess) return p.expression === this;
        // (~x)`foo`
        if (p instanceof AST_Template) return p.tag === this;
    }
    PARENS(AST_Await, needs_parens_unary);
    PARENS(AST_Unary, needs_parens_unary);

    PARENS(AST_Sequence, function(output) {
        var p = output.parent();
            // [ 1, (2, 3), 4 ] ---> [ 1, 3, 4 ]
        return p instanceof AST_Array
            // () ---> (foo, bar)
            || is_arrow(p) && p.value === this
            // await (foo, bar)
            || p instanceof AST_Await
            // 1 + (2, 3) + 4 ---> 8
            || p instanceof AST_Binary
            // new (foo, bar) or foo(1, (2, 3), 4)
            || p instanceof AST_Call
            // class extends (foo, bar) {}
            // class foo extends (bar, baz) {}
            || p instanceof AST_Class
            // class { foo = (bar, baz) }
            // class { [(foo, bar)]() {} }
            || p instanceof AST_ClassProperty
            // (false, true) ? (a = 10, b = 20) : (c = 30)
            // ---> 20 (side effect, set a := 10 and b := 20)
            || p instanceof AST_Conditional
            // [ a = (1, 2) ] = [] ---> a == 2
            || p instanceof AST_DefaultValue
            // { [(1, 2)]: foo } = bar
            // { 1: (2, foo) } = bar
            || p instanceof AST_DestructuredKeyVal
            // export default (foo, bar)
            || p instanceof AST_ExportDefault
            // for (foo of (bar, baz));
            || p instanceof AST_ForOf
            // { [(1, 2)]: 3 }[2] ---> 3
            // { foo: (1, 2) }.foo ---> 2
            || p instanceof AST_ObjectProperty
            // (1, {foo:2}).foo or (1, {foo:2})["foo"] ---> 2
            || p instanceof AST_PropAccess && p.expression === this
            // ...(foo, bar, baz)
            || p instanceof AST_Spread
            // (foo, bar)`baz`
            || p instanceof AST_Template && p.tag === this
            // !(foo, bar, baz)
            || p instanceof AST_Unary
            // var a = (1, 2), b = a + a; ---> b == 4
            || p instanceof AST_VarDef
            // yield (foo, bar)
            || p instanceof AST_Yield;
    });

    PARENS(AST_Binary, function(output) {
        var p = output.parent();
        // await (foo && bar)
        if (p instanceof AST_Await) return true;
        // this deals with precedence:
        //   3 * (2 + 1)
        //   3 - (2 - 1)
        //   (1 ** 2) ** 3
        if (p instanceof AST_Binary) {
            var po = p.operator, pp = PRECEDENCE[po];
            var so = this.operator, sp = PRECEDENCE[so];
            return pp > sp
                || po == "??" && (so == "&&" || so == "||")
                || (pp == sp && this === p[po == "**" ? "left" : "right"]);
        }
        // (foo && bar)()
        if (p instanceof AST_Call) return p.expression === this;
        // class extends (foo && bar) {}
        // class foo extends (bar || null) {}
        if (p instanceof AST_Class) return true;
        // (foo && bar)["prop"], (foo && bar).prop
        if (p instanceof AST_PropAccess) return p.expression === this;
        // (foo && bar)``
        if (p instanceof AST_Template) return p.tag === this;
        // typeof (foo && bar)
        if (p instanceof AST_Unary) return true;
    });

    function need_chain_parens(node, parent) {
        if (!node.terminal) return false;
        if (!(parent instanceof AST_Call || parent instanceof AST_PropAccess)) return false;
        return parent.expression === node;
    }

    PARENS(AST_PropAccess, function(output) {
        var node = this;
        var p = output.parent();
        // i.e. new (foo().bar)
        //
        // if there's one call into this subtree, then we need
        // parens around it too, otherwise the call will be
        // interpreted as passing the arguments to the upper New
        // expression.
        if (p instanceof AST_New && p.expression === node && root_expr(node).TYPE == "Call") return true;
        // (foo?.bar)()
        // (foo?.bar).baz
        // new (foo?.bar)()
        return need_chain_parens(node, p);
    });

    PARENS(AST_Call, function(output) {
        var node = this;
        var p = output.parent();
        if (p instanceof AST_New) return p.expression === node;
        // https://bugs.webkit.org/show_bug.cgi?id=123506
        if (output.option("webkit")
            && node.expression instanceof AST_Function
            && p instanceof AST_PropAccess
            && p.expression === node) {
            var g = output.parent(1);
            if (g instanceof AST_Assign && g.left === p) return true;
        }
        // (foo?.())()
        // (foo?.()).bar
        // new (foo?.())()
        return need_chain_parens(node, p);
    });

    PARENS(AST_New, function(output) {
        if (need_constructor_parens(this, output)) return false;
        var p = output.parent();
        // (new foo)(bar)
        if (p instanceof AST_Call) return p.expression === this;
        // (new Date).getTime(), (new Date)["getTime"]()
        if (p instanceof AST_PropAccess) return true;
        // (new foo)`bar`
        if (p instanceof AST_Template) return p.tag === this;
    });

    PARENS(AST_Number, function(output) {
        if (!output.option("galio")) return false;
        // https://github.com/mishoo/UglifyJS/pull/1009
        var p = output.parent();
        return p instanceof AST_PropAccess && p.expression === this && /^0/.test(make_num(this.value));
    });

    function needs_parens_assign_cond(self, output) {
        var p = output.parent();
        // await (a = foo)
        if (p instanceof AST_Await) return true;
        // 1 + (a = 2) + 3 → 6, side effect setting a = 2
        if (p instanceof AST_Binary) return !(p instanceof AST_Assign);
        // (a = func)() —or— new (a = Object)()
        if (p instanceof AST_Call) return p.expression === self;
        // class extends (a = foo) {}
        // class foo extends (bar ? baz : moo) {}
        if (p instanceof AST_Class) return true;
        // (a = foo) ? bar : baz
        if (p instanceof AST_Conditional) return p.condition === self;
        // (a = foo)["prop"] —or— (a = foo).prop
        if (p instanceof AST_PropAccess) return p.expression === self;
        // (a = foo)`bar`
        if (p instanceof AST_Template) return p.tag === self;
        // !(a = false) → true
        if (p instanceof AST_Unary) return true;
    }
    PARENS(AST_Arrow, function(output) {
        return needs_parens_assign_cond(this, output);
    });
    PARENS(AST_Assign, function(output) {
        if (needs_parens_assign_cond(this, output)) return true;
        //  v8 parser bug   --->     workaround
        // f([1], [a] = []) ---> f([1], ([a] = []))
        if (output.option("v8")) return this.left instanceof AST_Destructured;
        // ({ p: a } = o);
        if (this.left instanceof AST_DestructuredObject) return needs_parens_obj(output);
    });
    PARENS(AST_AsyncArrow, function(output) {
        return needs_parens_assign_cond(this, output);
    });
    PARENS(AST_Conditional, function(output) {
        return needs_parens_assign_cond(this, output)
            // https://github.com/mishoo/UglifyJS/issues/1144
            || output.option("extendscript") && output.parent() instanceof AST_Conditional;
    });
    PARENS(AST_Yield, function(output) {
        return needs_parens_assign_cond(this, output);
    });

    /* -----[ PRINTERS ]----- */

    DEFPRINT(AST_Directive, function(output) {
        var quote = this.quote;
        var value = this.value;
        switch (output.option("quote_style")) {
          case 0:
          case 2:
            if (value.indexOf('"') == -1) quote = '"';
            break;
          case 1:
            if (value.indexOf("'") == -1) quote = "'";
            break;
        }
        output.print(quote + value + quote);
        output.semicolon();
    });
    DEFPRINT(AST_Debugger, function(output) {
        output.print("debugger");
        output.semicolon();
    });

    /* -----[ statements ]----- */

    function display_body(body, is_toplevel, output, allow_directives) {
        var last = body.length - 1;
        var in_directive = allow_directives;
        var was_asm = use_asm;
        body.forEach(function(stmt, i) {
            if (in_directive) {
                if (stmt instanceof AST_Directive) {
                    if (stmt.value == "use asm") use_asm = true;
                } else if (!(stmt instanceof AST_EmptyStatement)) {
                    if (stmt instanceof AST_SimpleStatement && stmt.body instanceof AST_String) {
                        output.force_semicolon();
                    }
                    in_directive = false;
                }
            }
            if (stmt instanceof AST_EmptyStatement) return;
            output.indent();
            stmt.print(output);
            if (i == last && is_toplevel) return;
            output.newline();
            if (is_toplevel) output.newline();
        });
        use_asm = was_asm;
    }

    DEFPRINT(AST_Toplevel, function(output) {
        display_body(this.body, true, output, true);
        output.print("");
    });
    DEFPRINT(AST_LabeledStatement, function(output) {
        this.label.print(output);
        output.colon();
        this.body.print(output);
    });
    DEFPRINT(AST_SimpleStatement, function(output) {
        this.body.print(output);
        output.semicolon();
    });
    function print_braced_empty(self, output) {
        output.print("{");
        output.with_indent(function() {
            output.append_comments(self, true);
        });
        output.print("}");
    }
    function print_braced(self, output, allow_directives) {
        if (self.body.length > 0) {
            output.with_block(function() {
                display_body(self.body, false, output, allow_directives);
            }, self.end);
        } else print_braced_empty(self, output);
    }
    DEFPRINT(AST_BlockStatement, function(output) {
        print_braced(this, output);
    });
    DEFPRINT(AST_EmptyStatement, function(output) {
        output.semicolon();
    });
    DEFPRINT(AST_Do, function(output) {
        var self = this;
        output.print("do");
        make_block(self.body, output);
        output.space();
        output.print("while");
        output.space();
        output.with_parens(function() {
            self.condition.print(output);
        });
        output.semicolon();
    });
    DEFPRINT(AST_While, function(output) {
        var self = this;
        output.print("while");
        output.space();
        output.with_parens(function() {
            self.condition.print(output);
        });
        force_statement(self.body, output);
    });
    DEFPRINT(AST_For, function(output) {
        var self = this;
        output.print("for");
        output.space();
        output.with_parens(function() {
            if (self.init) {
                if (self.init instanceof AST_Definitions) {
                    self.init.print(output);
                } else {
                    parenthesize_for_no_in(self.init, output, true);
                }
                output.print(";");
                output.space();
            } else {
                output.print(";");
            }
            if (self.condition) {
                self.condition.print(output);
                output.print(";");
                output.space();
            } else {
                output.print(";");
            }
            if (self.step) {
                self.step.print(output);
            }
        });
        force_statement(self.body, output);
    });
    function print_for_enum(prefix, infix) {
        return function(output) {
            var self = this;
            output.print(prefix);
            output.space();
            output.with_parens(function() {
                self.init.print(output);
                output.space();
                output.print(infix);
                output.space();
                self.object.print(output);
            });
            force_statement(self.body, output);
        };
    }
    DEFPRINT(AST_ForAwaitOf, print_for_enum("for await", "of"));
    DEFPRINT(AST_ForIn, print_for_enum("for", "in"));
    DEFPRINT(AST_ForOf, print_for_enum("for", "of"));
    DEFPRINT(AST_With, function(output) {
        var self = this;
        output.print("with");
        output.space();
        output.with_parens(function() {
            self.expression.print(output);
        });
        force_statement(self.body, output);
    });
    DEFPRINT(AST_ExportDeclaration, function(output) {
        output.print("export");
        output.space();
        this.body.print(output);
    });
    DEFPRINT(AST_ExportDefault, function(output) {
        output.print("export");
        output.space();
        output.print("default");
        output.space();
        var body = this.body;
        body.print(output);
        if (body instanceof AST_ClassExpression) {
            if (!body.name) return;
        }
        if (body instanceof AST_DefClass) return;
        if (body instanceof AST_LambdaDefinition) return;
        if (body instanceof AST_LambdaExpression) {
            if (!body.name && !is_arrow(body)) return;
        }
        output.semicolon();
    });
    function print_alias(alias, output) {
        var value = alias.value;
        if (value == "*" || is_identifier_string(value)) {
            output.print_name(value);
        } else {
            output.print_string(value, alias.quote);
        }
    }
    DEFPRINT(AST_ExportForeign, function(output) {
        var self = this;
        output.print("export");
        output.space();
        var len = self.keys.length;
        if (len == 0) {
            print_braced_empty(self, output);
        } else if (self.keys[0].value == "*") {
            print_entry(0);
        } else output.with_block(function() {
            output.indent();
            print_entry(0);
            for (var i = 1; i < len; i++) {
                output.print(",");
                output.newline();
                output.indent();
                print_entry(i);
            }
            output.newline();
        }, self.end);
        output.space();
        output.print("from");
        output.space();
        self.path.print(output);
        output.semicolon();

        function print_entry(index) {
            var alias = self.aliases[index];
            var key = self.keys[index];
            print_alias(key, output);
            if (alias.value != key.value) {
                output.space();
                output.print("as");
                output.space();
                print_alias(alias, output);
            }
        }
    });
    DEFPRINT(AST_ExportReferences, function(output) {
        var self = this;
        output.print("export");
        output.space();
        print_properties(self, output);
        output.semicolon();
    });
    DEFPRINT(AST_Import, function(output) {
        var self = this;
        output.print("import");
        output.space();
        if (self.default) self.default.print(output);
        if (self.all) {
            if (self.default) output.comma();
            self.all.print(output);
        }
        if (self.properties) {
            if (self.default) output.comma();
            print_properties(self, output);
        }
        if (self.all || self.default || self.properties) {
            output.space();
            output.print("from");
            output.space();
        }
        self.path.print(output);
        output.semicolon();
    });

    /* -----[ functions ]----- */
    function print_funargs(self, output) {
        output.with_parens(function() {
            self.argnames.forEach(function(arg, i) {
                if (i) output.comma();
                arg.print(output);
            });
            if (self.rest) {
                if (self.argnames.length) output.comma();
                output.print("...");
                self.rest.print(output);
            }
        });
    }
    function print_arrow(self, output) {
        var argname = self.argnames.length == 1 && !self.rest && self.argnames[0];
        if (argname instanceof AST_SymbolFunarg && argname.name != "yield") {
            argname.print(output);
        } else {
            print_funargs(self, output);
        }
        output.space();
        output.print("=>");
        output.space();
        if (self.value) {
            self.value.print(output);
        } else {
            print_braced(self, output, true);
        }
    }
    DEFPRINT(AST_Arrow, function(output) {
        print_arrow(this, output);
    });
    DEFPRINT(AST_AsyncArrow, function(output) {
        output.print("async");
        output.space();
        print_arrow(this, output);
    });
    function print_lambda(self, output) {
        if (self.name) {
            output.space();
            self.name.print(output);
        }
        print_funargs(self, output);
        output.space();
        print_braced(self, output, true);
    }
    DEFPRINT(AST_Lambda, function(output) {
        output.print("function");
        print_lambda(this, output);
    });
    function print_async(output) {
        output.print("async");
        output.space();
        output.print("function");
        print_lambda(this, output);
    }
    DEFPRINT(AST_AsyncDefun, print_async);
    DEFPRINT(AST_AsyncFunction, print_async);
    function print_async_generator(output) {
        output.print("async");
        output.space();
        output.print("function*");
        print_lambda(this, output);
    }
    DEFPRINT(AST_AsyncGeneratorDefun, print_async_generator);
    DEFPRINT(AST_AsyncGeneratorFunction, print_async_generator);
    function print_generator(output) {
        output.print("function*");
        print_lambda(this, output);
    }
    DEFPRINT(AST_GeneratorDefun, print_generator);
    DEFPRINT(AST_GeneratorFunction, print_generator);

    /* -----[ classes ]----- */
    DEFPRINT(AST_Class, function(output) {
        var self = this;
        output.print("class");
        if (self.name) {
            output.space();
            self.name.print(output);
        }
        if (self.extends) {
            output.space();
            output.print("extends");
            output.space();
            self.extends.print(output);
        }
        output.space();
        print_properties(self, output, true);
    });
    DEFPRINT(AST_ClassField, function(output) {
        var self = this;
        if (self.static) {
            output.print("static");
            output.space();
        }
        print_property_key(self, output);
        if (self.value) {
            output.space();
            output.print("=");
            output.space();
            self.value.print(output);
        }
        output.semicolon();
    });
    DEFPRINT(AST_ClassGetter, print_accessor("get"));
    DEFPRINT(AST_ClassSetter, print_accessor("set"));
    function print_method(self, output) {
        var fn = self.value;
        if (is_async(fn)) {
            output.print("async");
            output.space();
        }
        if (is_generator(fn)) output.print("*");
        print_property_key(self, output);
        print_lambda(self.value, output);
    }
    DEFPRINT(AST_ClassMethod, function(output) {
        var self = this;
        if (self.static) {
            output.print("static");
            output.space();
        }
        print_method(self, output);
    });
    DEFPRINT(AST_ClassInit, function(output) {
        output.print("static");
        output.space();
        print_braced(this.value, output);
    });

    /* -----[ jumps ]----- */
    function print_jump(kind, prop) {
        return function(output) {
            output.print(kind);
            var target = this[prop];
            if (target) {
                output.space();
                target.print(output);
            }
            output.semicolon();
        };
    }
    DEFPRINT(AST_Return, print_jump("return", "value"));
    DEFPRINT(AST_Throw, print_jump("throw", "value"));
    DEFPRINT(AST_Break, print_jump("break", "label"));
    DEFPRINT(AST_Continue, print_jump("continue", "label"));

    /* -----[ if ]----- */
    function make_then(self, output) {
        var b = self.body;
        if (output.option("braces") && !(b instanceof AST_Const || b instanceof AST_Let)
            || output.option("ie") && b instanceof AST_Do)
            return make_block(b, output);
        // The squeezer replaces "block"-s that contain only a single
        // statement with the statement itself; technically, the AST
        // is correct, but this can create problems when we output an
        // IF having an ELSE clause where the THEN clause ends in an
        // IF *without* an ELSE block (then the outer ELSE would refer
        // to the inner IF).  This function checks for this case and
        // adds the block braces if needed.
        if (!b) return output.force_semicolon();
        while (true) {
            if (b instanceof AST_If) {
                if (!b.alternative) {
                    make_block(self.body, output);
                    return;
                }
                b = b.alternative;
            } else if (b instanceof AST_StatementWithBody) {
                b = b.body;
            } else break;
        }
        force_statement(self.body, output);
    }
    DEFPRINT(AST_If, function(output) {
        var self = this;
        output.print("if");
        output.space();
        output.with_parens(function() {
            self.condition.print(output);
        });
        if (self.alternative) {
            make_then(self, output);
            output.space();
            output.print("else");
            if (self.alternative instanceof AST_If) {
                output.space();
                self.alternative.print(output);
            } else {
                force_statement(self.alternative, output);
            }
        } else {
            force_statement(self.body, output);
        }
    });

    /* -----[ switch ]----- */
    DEFPRINT(AST_Switch, function(output) {
        var self = this;
        output.print("switch");
        output.space();
        output.with_parens(function() {
            self.expression.print(output);
        });
        output.space();
        var last = self.body.length - 1;
        if (last < 0) print_braced_empty(self, output);
        else output.with_block(function() {
            self.body.forEach(function(branch, i) {
                output.indent(true);
                branch.print(output);
                if (i < last && branch.body.length > 0)
                    output.newline();
            });
        }, self.end);
    });
    function print_branch_body(self, output) {
        output.newline();
        self.body.forEach(function(stmt) {
            output.indent();
            stmt.print(output);
            output.newline();
        });
    }
    DEFPRINT(AST_Default, function(output) {
        output.print("default:");
        print_branch_body(this, output);
    });
    DEFPRINT(AST_Case, function(output) {
        var self = this;
        output.print("case");
        output.space();
        self.expression.print(output);
        output.print(":");
        print_branch_body(self, output);
    });

    /* -----[ exceptions ]----- */
    DEFPRINT(AST_Try, function(output) {
        var self = this;
        output.print("try");
        output.space();
        print_braced(self, output);
        if (self.bcatch) {
            output.space();
            self.bcatch.print(output);
        }
        if (self.bfinally) {
            output.space();
            self.bfinally.print(output);
        }
    });
    DEFPRINT(AST_Catch, function(output) {
        var self = this;
        output.print("catch");
        if (self.argname) {
            output.space();
            output.with_parens(function() {
                self.argname.print(output);
            });
        }
        output.space();
        print_braced(self, output);
    });
    DEFPRINT(AST_Finally, function(output) {
        output.print("finally");
        output.space();
        print_braced(this, output);
    });

    function print_definitions(type) {
        return function(output) {
            var self = this;
            output.print(type);
            output.space();
            self.definitions.forEach(function(def, i) {
                if (i) output.comma();
                def.print(output);
            });
            var p = output.parent();
            if (!(p instanceof AST_IterationStatement && p.init === self)) output.semicolon();
        };
    }
    DEFPRINT(AST_Const, print_definitions("const"));
    DEFPRINT(AST_Let, print_definitions("let"));
    DEFPRINT(AST_Var, print_definitions("var"));

    function parenthesize_for_no_in(node, output, no_in) {
        var parens = false;
        // need to take some precautions here:
        //    https://github.com/mishoo/UglifyJS/issues/60
        if (no_in) node.walk(new TreeWalker(function(node) {
            if (parens) return true;
            if (node instanceof AST_Binary && node.operator == "in") return parens = true;
            if (node instanceof AST_Scope && !(is_arrow(node) && node.value)) return true;
        }));
        node.print(output, parens);
    }

    DEFPRINT(AST_VarDef, function(output) {
        var self = this;
        self.name.print(output);
        if (self.value) {
            output.space();
            output.print("=");
            output.space();
            var p = output.parent(1);
            var no_in = p instanceof AST_For || p instanceof AST_ForEnumeration;
            parenthesize_for_no_in(self.value, output, no_in);
        }
    });

    DEFPRINT(AST_DefaultValue, function(output) {
        var self = this;
        self.name.print(output);
        output.space();
        output.print("=");
        output.space();
        self.value.print(output);
    });

    /* -----[ other expressions ]----- */
    function print_annotation(self, output) {
        if (!output.option("annotations")) return;
        if (!self.pure) return;
        var level = 0, parent = self, node;
        do {
            node = parent;
            parent = output.parent(level++);
            if (parent instanceof AST_Call && parent.expression === node) return;
        } while (parent instanceof AST_PropAccess && parent.expression === node);
        output.print("/*@__PURE__*/");
    }
    function print_call_args(self, output) {
        output.with_parens(function() {
            self.args.forEach(function(expr, i) {
                if (i) output.comma();
                expr.print(output);
            });
            output.add_mapping(self.end);
        });
    }
    DEFPRINT(AST_Call, function(output) {
        var self = this;
        print_annotation(self, output);
        self.expression.print(output);
        if (self.optional) output.print("?.");
        print_call_args(self, output);
    });
    DEFPRINT(AST_New, function(output) {
        var self = this;
        print_annotation(self, output);
        output.print("new");
        output.space();
        self.expression.print(output);
        if (need_constructor_parens(self, output)) print_call_args(self, output);
    });
    DEFPRINT(AST_Sequence, function(output) {
        this.expressions.forEach(function(node, index) {
            if (index > 0) {
                output.comma();
                if (output.should_break()) {
                    output.newline();
                    output.indent();
                }
            }
            node.print(output);
        });
    });
    DEFPRINT(AST_Dot, function(output) {
        var self = this;
        var expr = self.expression;
        expr.print(output);
        var prop = self.property;
        if (output.option("ie") && RESERVED_WORDS[prop] || self.quoted && output.option("keep_quoted_props")) {
            if (self.optional) output.print("?.");
            output.with_square(function() {
                output.add_mapping(self.end);
                output.print_string(prop);
            });
        } else {
            if (expr instanceof AST_Number && !/[ex.)]/i.test(output.last())) output.print(".");
            output.print(self.optional ? "?." : ".");
            // the name after dot would be mapped about here.
            output.add_mapping(self.end);
            output.print_name(prop);
        }
    });
    DEFPRINT(AST_Sub, function(output) {
        var self = this;
        self.expression.print(output);
        if (self.optional) output.print("?.");
        output.with_square(function() {
            self.property.print(output);
        });
    });
    DEFPRINT(AST_Spread, function(output) {
        output.print("...");
        this.expression.print(output);
    });
    DEFPRINT(AST_UnaryPrefix, function(output) {
        var op = this.operator;
        var exp = this.expression;
        output.print(op);
        if (/^[a-z]/i.test(op)
            || (/[+-]$/.test(op)
                && exp instanceof AST_UnaryPrefix
                && /^[+-]/.test(exp.operator))) {
            output.space();
        }
        exp.print(output);
    });
    DEFPRINT(AST_UnaryPostfix, function(output) {
        var self = this;
        self.expression.print(output);
        output.add_mapping(self.end);
        output.print(self.operator);
    });
    DEFPRINT(AST_Binary, function(output) {
        var self = this;
        self.left.print(output);
        output.space();
        output.print(self.operator);
        output.space();
        self.right.print(output);
    });
    DEFPRINT(AST_Conditional, function(output) {
        var self = this;
        self.condition.print(output);
        output.space();
        output.print("?");
        output.space();
        self.consequent.print(output);
        output.space();
        output.colon();
        self.alternative.print(output);
    });
    DEFPRINT(AST_Await, function(output) {
        output.print("await");
        output.space();
        this.expression.print(output);
    });
    DEFPRINT(AST_Yield, function(output) {
        output.print(this.nested ? "yield*" : "yield");
        if (this.expression) {
            output.space();
            this.expression.print(output);
        }
    });

    /* -----[ literals ]----- */
    DEFPRINT(AST_Array, function(output) {
        var a = this.elements, len = a.length;
        output.with_square(len > 0 ? function() {
            output.space();
            a.forEach(function(exp, i) {
                if (i) output.comma();
                exp.print(output);
                // If the final element is a hole, we need to make sure it
                // doesn't look like a trailing comma, by inserting an actual
                // trailing comma.
                if (i === len - 1 && exp instanceof AST_Hole)
                  output.comma();
            });
            output.space();
        } : noop);
    });
    DEFPRINT(AST_DestructuredArray, function(output) {
        var a = this.elements, len = a.length, rest = this.rest;
        output.with_square(len || rest ? function() {
            output.space();
            a.forEach(function(exp, i) {
                if (i) output.comma();
                exp.print(output);
            });
            if (rest) {
                if (len) output.comma();
                output.print("...");
                rest.print(output);
            } else if (a[len - 1] instanceof AST_Hole) {
                // If the final element is a hole, we need to make sure it
                // doesn't look like a trailing comma, by inserting an actual
                // trailing comma.
                output.comma();
            }
            output.space();
        } : noop);
    });
    DEFPRINT(AST_DestructuredKeyVal, function(output) {
        var self = this;
        var key = print_property_key(self, output);
        var value = self.value;
        if (key) {
            if (value instanceof AST_DefaultValue) {
                if (value.name instanceof AST_Symbol && key == get_symbol_name(value.name)) {
                    output.space();
                    output.print("=");
                    output.space();
                    value.value.print(output);
                    return;
                }
            } else if (value instanceof AST_Symbol) {
                if (key == get_symbol_name(value)) return;
            }
        }
        output.colon();
        value.print(output);
    });
    DEFPRINT(AST_DestructuredObject, function(output) {
        var self = this;
        var props = self.properties, len = props.length, rest = self.rest;
        if (len || rest) output.with_block(function() {
            props.forEach(function(prop, i) {
                if (i) {
                    output.print(",");
                    output.newline();
                }
                output.indent();
                prop.print(output);
            });
            if (rest) {
                if (len) {
                    output.print(",");
                    output.newline();
                }
                output.indent();
                output.print("...");
                rest.print(output);
            }
            output.newline();
        }, self.end);
        else print_braced_empty(self, output);
    });
    function print_properties(self, output, no_comma) {
        var props = self.properties;
        if (props.length > 0) output.with_block(function() {
            props.forEach(function(prop, i) {
                if (i) {
                    if (!no_comma) output.print(",");
                    output.newline();
                }
                output.indent();
                prop.print(output);
            });
            output.newline();
        }, self.end);
        else print_braced_empty(self, output);
    }
    DEFPRINT(AST_Object, function(output) {
        print_properties(this, output);
    });

    function print_property_key(self, output) {
        var key = self.key;
        if (key instanceof AST_Node) return output.with_square(function() {
            key.print(output);
        });
        var quote = self.start && self.start.quote;
        if (output.option("quote_keys") || quote && output.option("keep_quoted_props")) {
            output.print_string(key, quote);
        } else if ("" + +key == key && key >= 0) {
            output.print(make_num(key));
        } else if (self.private) {
            output.print_name(key);
        } else if (RESERVED_WORDS[key] ? !output.option("ie") : is_identifier_string(key)) {
            output.print_name(key);
            return key;
        } else {
            output.print_string(key, quote);
        }
    }
    DEFPRINT(AST_ObjectKeyVal, function(output) {
        var self = this;
        print_property_key(self, output);
        output.colon();
        self.value.print(output);
    });
    DEFPRINT(AST_ObjectMethod, function(output) {
        print_method(this, output);
    });
    function print_accessor(type) {
        return function(output) {
            var self = this;
            if (self.static) {
                output.print("static");
                output.space();
            }
            output.print(type);
            output.space();
            print_property_key(self, output);
            print_lambda(self.value, output);
        };
    }
    DEFPRINT(AST_ObjectGetter, print_accessor("get"));
    DEFPRINT(AST_ObjectSetter, print_accessor("set"));
    function get_symbol_name(sym) {
        var def = sym.definition();
        return def && def.mangled_name || sym.name;
    }
    DEFPRINT(AST_Symbol, function(output) {
        output.print_name(get_symbol_name(this));
    });
    DEFPRINT(AST_SymbolExport, function(output) {
        var self = this;
        var name = get_symbol_name(self);
        output.print_name(name);
        var alias = self.alias;
        if (alias.value != name) {
            output.space();
            output.print("as");
            output.space();
            print_alias(alias, output);
        }
    });
    DEFPRINT(AST_SymbolImport, function(output) {
        var self = this;
        var name = get_symbol_name(self);
        var key = self.key;
        if (key.value && key.value != name) {
            print_alias(key, output);
            output.space();
            output.print("as");
            output.space();
        }
        output.print_name(name);
    });
    DEFPRINT(AST_Hole, noop);
    DEFPRINT(AST_Template, function(output) {
        var self = this;
        if (self.tag) self.tag.print(output);
        output.print("`");
        for (var i = 0; i < self.expressions.length; i++) {
            output.print(self.strings[i]);
            output.print("${");
            self.expressions[i].print(output);
            output.print("}");
        }
        output.print(self.strings[i]);
        output.print("`");
    });
    DEFPRINT(AST_Constant, function(output) {
        output.print("" + this.value);
    });
    DEFPRINT(AST_String, function(output) {
        output.print_string(this.value, this.quote);
    });
    DEFPRINT(AST_Number, function(output) {
        var start = this.start;
        if (use_asm && start && start.raw != null) {
            output.print(start.raw);
        } else {
            output.print(make_num(this.value));
        }
    });

    DEFPRINT(AST_RegExp, function(output) {
        var regexp = this.value;
        var str = regexp.toString();
        var end = str.lastIndexOf("/");
        if (regexp.raw_source) {
            str = "/" + regexp.raw_source + str.slice(end);
        } else if (end == 1) {
            str = "/(?:)" + str.slice(end);
        } else if (str.indexOf("/", 1) < end) {
            str = "/" + str.slice(1, end).replace(/\\\\|[^/]?\//g, function(match) {
                return match[0] == "\\" ? match : match.slice(0, -1) + "\\/";
            }) + str.slice(end);
        }
        output.print(output.to_utf8(str).replace(/\\(?:\0(?![0-9])|[^\0])/g, function(match) {
            switch (match[1]) {
              case "\n": return "\\n";
              case "\r": return "\\r";
              case "\t": return "\t";
              case "\b": return "\b";
              case "\f": return "\f";
              case "\0": return "\0";
              case "\x0B": return "\v";
              case "\u2028": return "\\u2028";
              case "\u2029": return "\\u2029";
              default: return match;
            }
        }).replace(/[\n\r\u2028\u2029]/g, function(c) {
            switch (c) {
              case "\n": return "\\n";
              case "\r": return "\\r";
              case "\u2028": return "\\u2028";
              case "\u2029": return "\\u2029";
            }
        }));
    });

    function force_statement(stat, output) {
        if (output.option("braces") && !(stat instanceof AST_Const || stat instanceof AST_Let)) {
            make_block(stat, output);
        } else if (stat instanceof AST_EmptyStatement) {
            output.force_semicolon();
        } else {
            output.space();
            stat.print(output);
        }
    }

    // self should be AST_New.  decide if we want to show parens or not.
    function need_constructor_parens(self, output) {
        // Always print parentheses with arguments
        if (self.args.length > 0) return true;

        return output.option("beautify");
    }

    function best_of(a) {
        var best = a[0], len = best.length;
        for (var i = 1; i < a.length; ++i) {
            if (a[i].length < len) {
                best = a[i];
                len = best.length;
            }
        }
        return best;
    }

    function make_num(num) {
        var str = num.toString(10).replace(/^0\./, ".").replace("e+", "e");
        var candidates = [ str ];
        if (Math.floor(num) === num) {
            if (num < 0) {
                candidates.push("-0x" + (-num).toString(16).toLowerCase());
            } else {
                candidates.push("0x" + num.toString(16).toLowerCase());
            }
        }
        var match, len, digits;
        if (match = /^\.0+/.exec(str)) {
            len = match[0].length;
            digits = str.slice(len);
            candidates.push(digits + "e-" + (digits.length + len - 1));
        } else if (match = /[^0]0+$/.exec(str)) {
            len = match[0].length - 1;
            candidates.push(str.slice(0, -len) + "e" + len);
        } else if (match = /^(\d)\.(\d+)e(-?\d+)$/.exec(str)) {
            candidates.push(match[1] + match[2] + "e" + (match[3] - match[2].length));
        }
        return best_of(candidates);
    }

    function make_block(stmt, output) {
        output.space();
        if (stmt instanceof AST_EmptyStatement) {
            print_braced_empty(stmt, output);
        } else if (stmt instanceof AST_BlockStatement) {
            stmt.print(output);
        } else output.with_block(function() {
            output.indent();
            stmt.print(output);
            output.newline();
        }, stmt.end);
    }

    /* -----[ source map generators ]----- */

    function DEFMAP(nodetype, generator) {
        nodetype.forEach(function(nodetype) {
            nodetype.DEFMETHOD("add_source_map", generator);
        });
    }

    DEFMAP([
        // We could easily add info for ALL nodes, but it seems to me that
        // would be quite wasteful, hence this noop in the base class.
        AST_Node,
        // since the label symbol will mark it
        AST_LabeledStatement,
    ], noop);

    // XXX: I'm not exactly sure if we need it for all of these nodes,
    // or if we should add even more.
    DEFMAP([
        AST_Array,
        AST_Await,
        AST_BlockStatement,
        AST_Catch,
        AST_Constant,
        AST_Debugger,
        AST_Definitions,
        AST_Destructured,
        AST_Directive,
        AST_Finally,
        AST_Jump,
        AST_Lambda,
        AST_New,
        AST_Object,
        AST_Spread,
        AST_StatementWithBody,
        AST_Symbol,
        AST_Switch,
        AST_SwitchBranch,
        AST_Try,
        AST_UnaryPrefix,
        AST_Yield,
    ], function(output) {
        output.add_mapping(this.start);
    });

    DEFMAP([
        AST_ClassProperty,
        AST_DestructuredKeyVal,
        AST_ObjectProperty,
    ], function(output) {
        if (typeof this.key == "string") output.add_mapping(this.start, this.key);
    });
})();


/***********************************************************************

  A JavaScript tokenizer / parser / beautifier / compressor.
  https://github.com/mishoo/UglifyJS

  -------------------------------- (C) ---------------------------------

                           Author: Mihai Bazon
                         <mihai.bazon@gmail.com>
                       http://mihai.bazon.net/blog

  Distributed under the BSD license:

    Copyright 2012 (c) Mihai Bazon <mihai.bazon@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:

        * Redistributions of source code must retain the above
          copyright notice, this list of conditions and the following
          disclaimer.

        * Redistributions in binary form must reproduce the above
          copyright notice, this list of conditions and the following
          disclaimer in the documentation and/or other materials
          provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
    EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
    PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
    OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
    PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
    PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
    TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
    THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
    SUCH DAMAGE.

 ***********************************************************************/

"use strict";

var vlq_char = characters("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
var vlq_bits = vlq_char.reduce(function(map, ch, bits) {
    map[ch] = bits;
    return map;
}, Object.create(null));

function vlq_decode(indices, str) {
    var value = 0;
    var shift = 0;
    for (var i = 0, j = 0; i < str.length; i++) {
        var bits = vlq_bits[str[i]];
        value += (bits & 31) << shift;
        if (bits & 32) {
            shift += 5;
        } else {
            indices[j++] += value & 1 ? 0x80000000 | -(value >> 1) : value >> 1;
            value = shift = 0;
        }
    }
    return j;
}

function vlq_encode(num) {
    var result = "";
    num = Math.abs(num) << 1 | num >>> 31;
    do {
        var bits = num & 31;
        if (num >>>= 5) bits |= 32;
        result += vlq_char[bits];
    } while (num);
    return result;
}

function create_array_map() {
    var map = new Dictionary();
    var array = [];
    array.index = function(name) {
        var index = map.get(name);
        if (!(index >= 0)) {
            index = array.length;
            array.push(name);
            map.set(name, index);
        }
        return index;
    };
    return array;
}

function SourceMap(options) {
    var sources = create_array_map();
    var sources_content = options.includeSources && new Dictionary();
    var names = create_array_map();
    var mappings = "";
    if (options.orig) Object.keys(options.orig).forEach(function(name) {
        var map = options.orig[name];
        var indices = [ 0, 0, 1, 0, 0 ];
        options.orig[name] = {
            names: map.names,
            mappings: map.mappings.split(/;/).map(function(line) {
                indices[0] = 0;
                return line.split(/,/).map(function(segment) {
                    return indices.slice(0, vlq_decode(indices, segment));
                });
            }),
            sources: map.sources,
        };
        if (!sources_content || !map.sourcesContent) return;
        for (var i = 0; i < map.sources.length; i++) {
            var content = map.sourcesContent[i];
            if (content) sources_content.set(map.sources[i], content);
        }
    });
    var prev_source;
    var generated_line = 1;
    var generated_column = 0;
    var source_index = 0;
    var original_line = 1;
    var original_column = 0;
    var name_index = 0;
    return {
        add: options.orig ? function(source, gen_line, gen_col, orig_line, orig_col, name) {
            var map = options.orig[source];
            if (map) {
                var segments = map.mappings[orig_line - 1];
                if (!segments) return;
                var indices;
                for (var i = 0; i < segments.length; i++) {
                    var col = segments[i][0];
                    if (orig_col >= col) indices = segments[i];
                    if (orig_col <= col) break;
                }
                if (!indices || indices.length < 4) {
                    source = null;
                } else {
                    source = map.sources[indices[1]];
                    orig_line = indices[2];
                    orig_col = indices[3];
                    if (indices.length > 4) name = map.names[indices[4]];
                }
            }
            add(source, gen_line, gen_col, orig_line, orig_col, name);
        } : add,
        setSourceContent: sources_content ? function(source, content) {
            if (!sources_content.has(source)) {
                sources_content.set(source, content);
            }
        } : noop,
        toString: function() {
            return JSON.stringify({
                version: 3,
                file: options.filename || undefined,
                sourceRoot: options.root || undefined,
                sources: sources,
                sourcesContent: sources_content ? sources.map(function(source) {
                    return sources_content.get(source) || null;
                }) : undefined,
                names: names,
                mappings: mappings,
            });
        }
    };

    function add(source, gen_line, gen_col, orig_line, orig_col, name) {
        if (prev_source == null && source == null) return;
        prev_source = source;
        if (generated_line < gen_line) {
            generated_column = 0;
            do {
                mappings += ";";
            } while (++generated_line < gen_line);
        } else if (mappings) {
            mappings += ",";
        }
        mappings += vlq_encode(gen_col - generated_column);
        generated_column = gen_col;
        if (source == null) return;
        var src_idx = sources.index(source);
        mappings += vlq_encode(src_idx - source_index);
        source_index = src_idx;
        mappings += vlq_encode(orig_line - original_line);
        original_line = orig_line;
        mappings += vlq_encode(orig_col - original_column);
        original_column = orig_col;
        if (options.names && name != null) {
            var name_idx = names.index(name);
            mappings += vlq_encode(name_idx - name_index);
            name_index = name_idx;
        }
    }
}


/***********************************************************************

  A JavaScript tokenizer / parser / beautifier / compressor.
  https://github.com/mishoo/UglifyJS

  -------------------------------- (C) ---------------------------------

                           Author: Mihai Bazon
                         <mihai.bazon@gmail.com>
                       http://mihai.bazon.net/blog

  Distributed under the BSD license:

    Copyright 2012 (c) Mihai Bazon <mihai.bazon@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:

        * Redistributions of source code must retain the above
          copyright notice, this list of conditions and the following
          disclaimer.

        * Redistributions in binary form must reproduce the above
          copyright notice, this list of conditions and the following
          disclaimer in the documentation and/or other materials
          provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
    EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
    PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
    OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
    PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
    PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
    TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
    THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
    SUCH DAMAGE.

 ***********************************************************************/

"use strict";

(function() {
    var MOZ_TO_ME = {
        Program: function(M) {
            return new AST_Toplevel({
                start: my_start_token(M),
                end: my_end_token(M),
                body: normalize_directives(M.body.map(from_moz)),
            });
        },
        ArrowFunctionExpression: function(M) {
            var argnames = [], rest = null;
            M.params.forEach(function(param) {
                if (param.type == "RestElement") {
                    rest = from_moz(param.argument);
                } else {
                    argnames.push(from_moz(param));
                }
            });
            var fn = new (M.async ? AST_AsyncArrow : AST_Arrow)({
                start: my_start_token(M),
                end: my_end_token(M),
                argnames: argnames,
                rest: rest,
            });
            var node = from_moz(M.body);
            if (node instanceof AST_BlockStatement) {
                fn.body = normalize_directives(node.body);
                fn.value = null;
            } else {
                fn.body = [];
                fn.value = node;
            }
            return fn;
        },
        FunctionDeclaration: function(M) {
            var ctor;
            if (M.async) {
                ctor = M.generator ? AST_AsyncGeneratorDefun : AST_AsyncDefun;
            } else {
                ctor = M.generator ? AST_GeneratorDefun : AST_Defun;
            }
            var argnames = [], rest = null;
            M.params.forEach(function(param) {
                if (param.type == "RestElement") {
                    rest = from_moz(param.argument);
                } else {
                    argnames.push(from_moz(param));
                }
            });
            return new ctor({
                start: my_start_token(M),
                end: my_end_token(M),
                name: from_moz(M.id),
                argnames: argnames,
                rest: rest,
                body: normalize_directives(from_moz(M.body).body),
            });
        },
        FunctionExpression: function(M) {
            var ctor;
            if (M.async) {
                ctor = M.generator ? AST_AsyncGeneratorFunction : AST_AsyncFunction;
            } else {
                ctor = M.generator ? AST_GeneratorFunction : AST_Function;
            }
            var argnames = [], rest = null;
            M.params.forEach(function(param) {
                if (param.type == "RestElement") {
                    rest = from_moz(param.argument);
                } else {
                    argnames.push(from_moz(param));
                }
            });
            return new ctor({
                start: my_start_token(M),
                end: my_end_token(M),
                name: from_moz(M.id),
                argnames: argnames,
                rest: rest,
                body: normalize_directives(from_moz(M.body).body),
            });
        },
        ClassDeclaration: function(M) {
            return new AST_DefClass({
                start: my_start_token(M),
                end: my_end_token(M),
                name: from_moz(M.id),
                extends: from_moz(M.superClass),
                properties: M.body.body.map(from_moz),
            });
        },
        ClassExpression: function(M) {
            return new AST_ClassExpression({
                start: my_start_token(M),
                end: my_end_token(M),
                name: from_moz(M.id),
                extends: from_moz(M.superClass),
                properties: M.body.body.map(from_moz),
            });
        },
        MethodDefinition: function(M) {
            var key = M.key, internal = false;
            if (M.computed) {
                key = from_moz(key);
            } else if (key.type == "PrivateIdentifier") {
                internal = true;
                key = "#" + key.name;
            } else {
                key = read_name(key);
            }
            var ctor = AST_ClassMethod, value = from_moz(M.value);
            switch (M.kind) {
              case "get":
                ctor = AST_ClassGetter;
                value = new AST_Accessor(value);
                break;
              case "set":
                ctor = AST_ClassSetter;
                value = new AST_Accessor(value);
                break;
            }
            return new ctor({
                start: my_start_token(M),
                end: my_end_token(M),
                key: key,
                private: internal,
                static: M.static,
                value: value,
            });
        },
        PropertyDefinition: function(M) {
            var key = M.key, internal = false;
            if (M.computed) {
                key = from_moz(key);
            } else if (key.type == "PrivateIdentifier") {
                internal = true;
                key = "#" + key.name;
            } else {
                key = read_name(key);
            }
            return new AST_ClassField({
                start: my_start_token(M),
                end: my_end_token(M),
                key: key,
                private: internal,
                static: M.static,
                value: from_moz(M.value),
            });
        },
        StaticBlock: function(M) {
            var start = my_start_token(M);
            var end = my_end_token(M);
            return new AST_ClassInit({
                start: start,
                end: end,
                value: new AST_ClassInitBlock({
                    start: start,
                    end: end,
                    body: normalize_directives(M.body.map(from_moz)),
                }),
            });
        },
        ForOfStatement: function(M) {
            return new (M.await ? AST_ForAwaitOf : AST_ForOf)({
                start: my_start_token(M),
                end: my_end_token(M),
                init: from_moz(M.left),
                object: from_moz(M.right),
                body: from_moz(M.body),
            });
        },
        TryStatement: function(M) {
            var handlers = M.handlers || [M.handler];
            if (handlers.length > 1 || M.guardedHandlers && M.guardedHandlers.length) {
                throw new Error("Multiple catch clauses are not supported.");
            }
            return new AST_Try({
                start    : my_start_token(M),
                end      : my_end_token(M),
                body     : from_moz(M.block).body,
                bcatch   : from_moz(handlers[0]),
                bfinally : M.finalizer ? new AST_Finally(from_moz(M.finalizer)) : null,
            });
        },
        Property: function(M) {
            var key = M.computed ? from_moz(M.key) : read_name(M.key);
            var args = {
                start: my_start_token(M),
                end: my_end_token(M),
                key: key,
                value: from_moz(M.value),
            };
            if (M.kind == "init") return new (M.method ? AST_ObjectMethod : AST_ObjectKeyVal)(args);
            args.value = new AST_Accessor(args.value);
            if (M.kind == "get") return new AST_ObjectGetter(args);
            if (M.kind == "set") return new AST_ObjectSetter(args);
        },
        ArrayExpression: function(M) {
            return new AST_Array({
                start: my_start_token(M),
                end: my_end_token(M),
                elements: M.elements.map(function(elem) {
                    return elem === null ? new AST_Hole() : from_moz(elem);
                }),
            });
        },
        ArrayPattern: function(M) {
            var elements = [], rest = null;
            M.elements.forEach(function(el) {
                if (el === null) {
                    elements.push(new AST_Hole());
                } else if (el.type == "RestElement") {
                    rest = from_moz(el.argument);
                } else {
                    elements.push(from_moz(el));
                }
            });
            return new AST_DestructuredArray({
                start: my_start_token(M),
                end: my_end_token(M),
                elements: elements,
                rest: rest,
            });
        },
        ObjectPattern: function(M) {
            var props = [], rest = null;
            M.properties.forEach(function(prop) {
                if (prop.type == "RestElement") {
                    rest = from_moz(prop.argument);
                } else {
                    props.push(new AST_DestructuredKeyVal(from_moz(prop)));
                }
            });
            return new AST_DestructuredObject({
                start: my_start_token(M),
                end: my_end_token(M),
                properties: props,
                rest: rest,
            });
        },
        MemberExpression: function(M) {
            return new (M.computed ? AST_Sub : AST_Dot)({
                start: my_start_token(M),
                end: my_end_token(M),
                optional: M.optional,
                expression: from_moz(M.object),
                property: M.computed ? from_moz(M.property) : M.property.name,
            });
        },
        MetaProperty: function(M) {
            var expr = from_moz(M.meta);
            var prop = read_name(M.property);
            if (expr.name == "new" && prop == "target") return new AST_NewTarget({
                start: my_start_token(M),
                end: my_end_token(M),
                name: "new.target",
            });
            return new AST_Dot({
                start: my_start_token(M),
                end: my_end_token(M),
                expression: expr,
                property: prop,
            });
        },
        SwitchCase: function(M) {
            return new (M.test ? AST_Case : AST_Default)({
                start      : my_start_token(M),
                end        : my_end_token(M),
                expression : from_moz(M.test),
                body       : M.consequent.map(from_moz),
            });
        },
        ExportAllDeclaration: function(M) {
            var start = my_start_token(M);
            var end = my_end_token(M);
            return new AST_ExportForeign({
                start: start,
                end: end,
                aliases: [ M.exported ? from_moz_alias(M.exported) : new AST_String({
                    start: start,
                    value: "*",
                    end: end,
                }) ],
                keys: [ new AST_String({
                    start: start,
                    value: "*",
                    end: end,
                }) ],
                path: from_moz(M.source),
            });
        },
        ExportDefaultDeclaration: function(M) {
            var decl = from_moz(M.declaration);
            if (!decl.name) switch (decl.CTOR) {
              case AST_AsyncDefun:
                decl = new AST_AsyncFunction(decl);
                break;
              case AST_AsyncGeneratorDefun:
                decl = new AST_AsyncGeneratorFunction(decl);
                break;
              case AST_DefClass:
                decl = new AST_ClassExpression(decl);
                break;
              case AST_Defun:
                decl = new AST_Function(decl);
                break;
              case AST_GeneratorDefun:
                decl = new AST_GeneratorFunction(decl);
                break;
            }
            return new AST_ExportDefault({
                start: my_start_token(M),
                end: my_end_token(M),
                body: decl,
            });
        },
        ExportNamedDeclaration: function(M) {
            if (M.declaration) return new AST_ExportDeclaration({
                start: my_start_token(M),
                end: my_end_token(M),
                body: from_moz(M.declaration),
            });
            if (M.source) {
                var aliases = [], keys = [];
                M.specifiers.forEach(function(prop) {
                    aliases.push(from_moz_alias(prop.exported));
                    keys.push(from_moz_alias(prop.local));
                });
                return new AST_ExportForeign({
                    start: my_start_token(M),
                    end: my_end_token(M),
                    aliases: aliases,
                    keys: keys,
                    path: from_moz(M.source),
                });
            }
            return new AST_ExportReferences({
                start: my_start_token(M),
                end: my_end_token(M),
                properties: M.specifiers.map(function(prop) {
                    var sym = new AST_SymbolExport(from_moz(prop.local));
                    sym.alias = from_moz_alias(prop.exported);
                    return sym;
                }),
            });
        },
        ImportDeclaration: function(M) {
            var start = my_start_token(M);
            var end = my_end_token(M);
            var all = null, def = null, props = null;
            M.specifiers.forEach(function(prop) {
                var sym = new AST_SymbolImport(from_moz(prop.local));
                switch (prop.type) {
                  case "ImportDefaultSpecifier":
                    def = sym;
                    def.key = new AST_String({
                        start: start,
                        value: "",
                        end: end,
                    });
                    break;
                  case "ImportNamespaceSpecifier":
                    all = sym;
                    all.key = new AST_String({
                        start: start,
                        value: "*",
                        end: end,
                    });
                    break;
                  default:
                    sym.key = from_moz_alias(prop.imported);
                    if (!props) props = [];
                    props.push(sym);
                    break;
                }
            });
            return new AST_Import({
                start: start,
                end: end,
                all: all,
                default: def,
                properties: props,
                path: from_moz(M.source),
            });
        },
        ImportExpression: function(M) {
            var start = my_start_token(M);
            var arg = from_moz(M.source);
            return new AST_Call({
                start: start,
                end: my_end_token(M),
                expression: new AST_SymbolRef({
                    start: start,
                    end: arg.start,
                    name: "import",
                }),
                args: [ arg ],
            });
        },
        VariableDeclaration: function(M) {
            return new ({
                const: AST_Const,
                let: AST_Let,
            }[M.kind] || AST_Var)({
                start: my_start_token(M),
                end: my_end_token(M),
                definitions: M.declarations.map(from_moz),
            });
        },
        Literal: function(M) {
            var args = {
                start: my_start_token(M),
                end: my_end_token(M),
            };
            if (M.bigint) {
                args.value = M.bigint.toLowerCase() + "n";
                return new AST_BigInt(args);
            }
            var val = M.value;
            if (val === null) return new AST_Null(args);
            var rx = M.regex;
            if (rx && rx.pattern) {
                // RegExpLiteral as per ESTree AST spec
                args.value = new RegExp(rx.pattern, rx.flags);
                args.value.raw_source = rx.pattern;
                return new AST_RegExp(args);
            } else if (rx) {
                // support legacy RegExp
                args.value = M.regex && M.raw ? M.raw : val;
                return new AST_RegExp(args);
            }
            switch (typeof val) {
              case "string":
                args.value = val;
                return new AST_String(args);
              case "number":
                if (isNaN(val)) return new AST_NaN(args);
                var negate, node;
                if (isFinite(val)) {
                    negate = 1 / val < 0;
                    args.value = negate ? -val : val;
                    node = new AST_Number(args);
                } else {
                    negate = val < 0;
                    node = new AST_Infinity(args);
                }
                return negate ? new AST_UnaryPrefix({
                    start: args.start,
                    end: args.end,
                    operator: "-",
                    expression: node,
                }) : node;
              case "boolean":
                return new (val ? AST_True : AST_False)(args);
            }
        },
        TemplateLiteral: function(M) {
            return new AST_Template({
                start: my_start_token(M),
                end: my_end_token(M),
                expressions: M.expressions.map(from_moz),
                strings: M.quasis.map(function(el) {
                    return el.value.raw;
                }),
            });
        },
        TaggedTemplateExpression: function(M) {
            var tmpl = from_moz(M.quasi);
            tmpl.start = my_start_token(M);
            tmpl.end = my_end_token(M);
            tmpl.tag = from_moz(M.tag);
            return tmpl;
        },
        Identifier: function(M) {
            var p, level = FROM_MOZ_STACK.length - 1;
            do {
                p = FROM_MOZ_STACK[--level];
            } while (p.type == "ArrayPattern"
                || p.type == "AssignmentPattern" && p.left === FROM_MOZ_STACK[level + 1]
                || p.type == "ObjectPattern"
                || p.type == "Property" && p.value === FROM_MOZ_STACK[level + 1]
                || p.type == "VariableDeclarator" && p.id === FROM_MOZ_STACK[level + 1]);
            var ctor = AST_SymbolRef;
            switch (p.type) {
              case "ArrowFunctionExpression":
                if (p.body !== FROM_MOZ_STACK[level + 1]) ctor = AST_SymbolFunarg;
                break;
              case "BreakStatement":
              case "ContinueStatement":
                ctor = AST_LabelRef;
                break;
              case "CatchClause":
                ctor = AST_SymbolCatch;
                break;
              case "ClassDeclaration":
                if (p.id === FROM_MOZ_STACK[level + 1]) ctor = AST_SymbolDefClass;
                break;
              case "ClassExpression":
                if (p.id === FROM_MOZ_STACK[level + 1]) ctor = AST_SymbolClass;
                break;
              case "FunctionDeclaration":
                ctor = p.id === FROM_MOZ_STACK[level + 1] ? AST_SymbolDefun : AST_SymbolFunarg;
                break;
              case "FunctionExpression":
                ctor = p.id === FROM_MOZ_STACK[level + 1] ? AST_SymbolLambda : AST_SymbolFunarg;
                break;
              case "LabeledStatement":
                ctor = AST_Label;
                break;
              case "VariableDeclaration":
                ctor = {
                    const: AST_SymbolConst,
                    let: AST_SymbolLet,
                }[p.kind] || AST_SymbolVar;
                break;
            }
            return new ctor({
                start: my_start_token(M),
                end: my_end_token(M),
                name: M.name,
            });
        },
        Super: function(M) {
            return new AST_Super({
                start: my_start_token(M),
                end: my_end_token(M),
                name: "super",
            });
        },
        ThisExpression: function(M) {
            return new AST_This({
                start: my_start_token(M),
                end: my_end_token(M),
                name: "this",
            });
        },
        ParenthesizedExpression: function(M) {
            var node = from_moz(M.expression);
            if (!node.start.parens) node.start.parens = [];
            node.start.parens.push(my_start_token(M));
            if (!node.end.parens) node.end.parens = [];
            node.end.parens.push(my_end_token(M));
            return node;
        },
        ChainExpression: function(M) {
            var node = from_moz(M.expression);
            node.terminal = true;
            return node;
        },
    };

    MOZ_TO_ME.UpdateExpression =
    MOZ_TO_ME.UnaryExpression = function To_Moz_Unary(M) {
        var prefix = "prefix" in M ? M.prefix
            : M.type == "UnaryExpression" ? true : false;
        return new (prefix ? AST_UnaryPrefix : AST_UnaryPostfix)({
            start      : my_start_token(M),
            end        : my_end_token(M),
            operator   : M.operator,
            expression : from_moz(M.argument)
        });
    };

    map("EmptyStatement", AST_EmptyStatement);
    map("ExpressionStatement", AST_SimpleStatement, "expression>body");
    map("BlockStatement", AST_BlockStatement, "body@body");
    map("IfStatement", AST_If, "test>condition, consequent>body, alternate>alternative");
    map("LabeledStatement", AST_LabeledStatement, "label>label, body>body");
    map("BreakStatement", AST_Break, "label>label");
    map("ContinueStatement", AST_Continue, "label>label");
    map("WithStatement", AST_With, "object>expression, body>body");
    map("SwitchStatement", AST_Switch, "discriminant>expression, cases@body");
    map("ReturnStatement", AST_Return, "argument>value");
    map("ThrowStatement", AST_Throw, "argument>value");
    map("WhileStatement", AST_While, "test>condition, body>body");
    map("DoWhileStatement", AST_Do, "test>condition, body>body");
    map("ForStatement", AST_For, "init>init, test>condition, update>step, body>body");
    map("ForInStatement", AST_ForIn, "left>init, right>object, body>body");
    map("DebuggerStatement", AST_Debugger);
    map("VariableDeclarator", AST_VarDef, "id>name, init>value");
    map("CatchClause", AST_Catch, "param>argname, body%body");

    map("BinaryExpression", AST_Binary, "operator=operator, left>left, right>right");
    map("LogicalExpression", AST_Binary, "operator=operator, left>left, right>right");
    map("AssignmentExpression", AST_Assign, "operator=operator, left>left, right>right");
    map("AssignmentPattern", AST_DefaultValue, "left>name, right>value");
    map("ConditionalExpression", AST_Conditional, "test>condition, consequent>consequent, alternate>alternative");
    map("NewExpression", AST_New, "callee>expression, arguments@args, pure=pure");
    map("CallExpression", AST_Call, "callee>expression, arguments@args, optional=optional, pure=pure");
    map("SequenceExpression", AST_Sequence, "expressions@expressions");
    map("SpreadElement", AST_Spread, "argument>expression");
    map("ObjectExpression", AST_Object, "properties@properties");
    map("AwaitExpression", AST_Await, "argument>expression");
    map("YieldExpression", AST_Yield, "argument>expression, delegate=nested");

    def_to_moz(AST_Toplevel, function To_Moz_Program(M) {
        return to_moz_scope("Program", M);
    });

    def_to_moz(AST_LambdaDefinition, function To_Moz_FunctionDeclaration(M) {
        var params = M.argnames.map(to_moz);
        if (M.rest) params.push({
            type: "RestElement",
            argument: to_moz(M.rest),
        });
        return {
            type: "FunctionDeclaration",
            id: to_moz(M.name),
            async: is_async(M),
            generator: is_generator(M),
            params: params,
            body: to_moz_scope("BlockStatement", M),
        };
    });

    def_to_moz(AST_Lambda, function To_Moz_FunctionExpression(M) {
        var params = M.argnames.map(to_moz);
        if (M.rest) params.push({
            type: "RestElement",
            argument: to_moz(M.rest),
        });
        if (is_arrow(M)) return {
            type: "ArrowFunctionExpression",
            async: is_async(M),
            params: params,
            body: M.value ? to_moz(M.value) : to_moz_scope("BlockStatement", M),
        };
        return {
            type: "FunctionExpression",
            id: to_moz(M.name),
            async: is_async(M),
            generator: is_generator(M),
            params: params,
            body: to_moz_scope("BlockStatement", M),
        };
    });

    def_to_moz(AST_DefClass, function To_Moz_ClassDeclaration(M) {
        return {
            type: "ClassDeclaration",
            id: to_moz(M.name),
            superClass: to_moz(M.extends),
            body: {
                type: "ClassBody",
                body: M.properties.map(to_moz),
            },
        };
    });

    def_to_moz(AST_ClassExpression, function To_Moz_ClassExpression(M) {
        return {
            type: "ClassExpression",
            id: to_moz(M.name),
            superClass: to_moz(M.extends),
            body: {
                type: "ClassBody",
                body: M.properties.map(to_moz),
            },
        };
    });

    function To_Moz_MethodDefinition(kind) {
        return function(M) {
            var computed = M.key instanceof AST_Node;
            var key = computed ? to_moz(M.key) : M.private ? {
                type: "PrivateIdentifier",
                name: M.key.slice(1),
            } : {
                type: "Literal",
                value: M.key,
            };
            return {
                type: "MethodDefinition",
                kind: kind,
                computed: computed,
                key: key,
                static: M.static,
                value: to_moz(M.value),
            };
        };
    }
    def_to_moz(AST_ClassGetter, To_Moz_MethodDefinition("get"));
    def_to_moz(AST_ClassSetter, To_Moz_MethodDefinition("set"));
    def_to_moz(AST_ClassMethod, To_Moz_MethodDefinition("method"));

    def_to_moz(AST_ClassField, function To_Moz_PropertyDefinition(M) {
        var computed = M.key instanceof AST_Node;
        var key = computed ? to_moz(M.key) : M.private ? {
            type: "PrivateIdentifier",
            name: M.key.slice(1),
        } : {
            type: "Literal",
            value: M.key,
        };
        return {
            type: "PropertyDefinition",
            computed: computed,
            key: key,
            static: M.static,
            value: to_moz(M.value),
        };
    });

    def_to_moz(AST_ClassInit, function To_Moz_StaticBlock(M) {
        return to_moz_scope("StaticBlock", M.value);
    });

    function To_Moz_ForOfStatement(is_await) {
        return function(M) {
            return {
                type: "ForOfStatement",
                await: is_await,
                left: to_moz(M.init),
                right: to_moz(M.object),
                body: to_moz(M.body),
            };
        };
    }
    def_to_moz(AST_ForAwaitOf, To_Moz_ForOfStatement(true));
    def_to_moz(AST_ForOf, To_Moz_ForOfStatement(false));

    def_to_moz(AST_Directive, function To_Moz_Directive(M) {
        return {
            type: "ExpressionStatement",
            expression: set_moz_loc(M, {
                type: "Literal",
                value: M.value,
            }),
        };
    });

    def_to_moz(AST_SwitchBranch, function To_Moz_SwitchCase(M) {
        return {
            type: "SwitchCase",
            test: to_moz(M.expression),
            consequent: M.body.map(to_moz),
        };
    });

    def_to_moz(AST_Try, function To_Moz_TryStatement(M) {
        return {
            type: "TryStatement",
            block: to_moz_block(M),
            handler: to_moz(M.bcatch),
            guardedHandlers: [],
            finalizer: to_moz(M.bfinally),
        };
    });

    def_to_moz(AST_Catch, function To_Moz_CatchClause(M) {
        return {
            type: "CatchClause",
            param: to_moz(M.argname),
            guard: null,
            body: to_moz_block(M),
        };
    });

    def_to_moz(AST_ExportDeclaration, function To_Moz_ExportNamedDeclaration_declaration(M) {
        return {
            type: "ExportNamedDeclaration",
            declaration: to_moz(M.body),
        };
    });

    def_to_moz(AST_ExportDefault, function To_Moz_ExportDefaultDeclaration(M) {
        return {
            type: "ExportDefaultDeclaration",
            declaration: to_moz(M.body),
        };
    });

    def_to_moz(AST_ExportForeign, function To_Moz_ExportAllDeclaration_ExportNamedDeclaration(M) {
        if (M.keys[0].value == "*") return {
            type: "ExportAllDeclaration",
            exported: M.aliases[0].value == "*" ? null : to_moz_alias(M.aliases[0]),
            source: to_moz(M.path),
        };
        var specifiers = [];
        for (var i = 0; i < M.aliases.length; i++) {
            specifiers.push(set_moz_loc({
                start: M.keys[i].start,
                end: M.aliases[i].end,
            }, {
                type: "ExportSpecifier",
                local: to_moz_alias(M.keys[i]),
                exported: to_moz_alias(M.aliases[i]),
            }));
        }
        return {
            type: "ExportNamedDeclaration",
            specifiers: specifiers,
            source: to_moz(M.path),
        };
    });

    def_to_moz(AST_ExportReferences, function To_Moz_ExportNamedDeclaration_specifiers(M) {
        return {
            type: "ExportNamedDeclaration",
            specifiers: M.properties.map(function(prop) {
                return set_moz_loc({
                    start: prop.start,
                    end: prop.alias.end,
                }, {
                    type: "ExportSpecifier",
                    local: to_moz(prop),
                    exported: to_moz_alias(prop.alias),
                });
            }),
        };
    });

    def_to_moz(AST_Import, function To_Moz_ImportDeclaration(M) {
        var specifiers = M.properties ? M.properties.map(function(prop) {
            return set_moz_loc({
                start: prop.key.start,
                end: prop.end,
            }, {
                type: "ImportSpecifier",
                local: to_moz(prop),
                imported: to_moz_alias(prop.key),
            });
        }) : [];
        if (M.all) specifiers.unshift(set_moz_loc(M.all, {
            type: "ImportNamespaceSpecifier",
            local: to_moz(M.all),
        }));
        if (M.default) specifiers.unshift(set_moz_loc(M.default, {
            type: "ImportDefaultSpecifier",
            local: to_moz(M.default),
        }));
        return {
            type: "ImportDeclaration",
            specifiers: specifiers,
            source: to_moz(M.path),
        };
    });

    def_to_moz(AST_Definitions, function To_Moz_VariableDeclaration(M) {
        return {
            type: "VariableDeclaration",
            kind: M.TYPE.toLowerCase(),
            declarations: M.definitions.map(to_moz),
        };
    });

    def_to_moz(AST_PropAccess, function To_Moz_MemberExpression(M) {
        var computed = M instanceof AST_Sub;
        var expr = {
            type: "MemberExpression",
            object: to_moz(M.expression),
            computed: computed,
            optional: M.optional,
            property: computed ? to_moz(M.property) : {
                type: "Identifier",
                name: M.property,
            },
        };
        return M.terminal ? {
            type: "ChainExpression",
            expression: expr,
        } : expr;
    });

    def_to_moz(AST_Unary, function To_Moz_Unary(M) {
        return {
            type: M.operator == "++" || M.operator == "--" ? "UpdateExpression" : "UnaryExpression",
            operator: M.operator,
            prefix: M instanceof AST_UnaryPrefix,
            argument: to_moz(M.expression)
        };
    });

    def_to_moz(AST_Binary, function To_Moz_BinaryExpression(M) {
        return {
            type: M.operator == "&&" || M.operator == "||" ? "LogicalExpression" : "BinaryExpression",
            left: to_moz(M.left),
            operator: M.operator,
            right: to_moz(M.right)
        };
    });

    def_to_moz(AST_Array, function To_Moz_ArrayExpression(M) {
        return {
            type: "ArrayExpression",
            elements: M.elements.map(to_moz),
        };
    });

    def_to_moz(AST_DestructuredArray, function To_Moz_ArrayPattern(M) {
        var elements = M.elements.map(to_moz);
        if (M.rest) elements.push({
            type: "RestElement",
            argument: to_moz(M.rest),
        });
        return {
            type: "ArrayPattern",
            elements: elements,
        };
    });

    def_to_moz(AST_DestructuredKeyVal, function To_Moz_Property(M) {
        var computed = M.key instanceof AST_Node;
        var key = computed ? to_moz(M.key) : {
            type: "Literal",
            value: M.key,
        };
        return {
            type: "Property",
            kind: "init",
            computed: computed,
            key: key,
            value: to_moz(M.value),
        };
    });

    def_to_moz(AST_DestructuredObject, function To_Moz_ObjectPattern(M) {
        var props = M.properties.map(to_moz);
        if (M.rest) props.push({
            type: "RestElement",
            argument: to_moz(M.rest),
        });
        return {
            type: "ObjectPattern",
            properties: props,
        };
    });

    def_to_moz(AST_ObjectProperty, function To_Moz_Property(M) {
        var computed = M.key instanceof AST_Node;
        var key = computed ? to_moz(M.key) : {
            type: "Literal",
            value: M.key,
        };
        var kind;
        if (M instanceof AST_ObjectKeyVal) {
            kind = "init";
        } else if (M instanceof AST_ObjectGetter) {
            kind = "get";
        } else if (M instanceof AST_ObjectSetter) {
            kind = "set";
        }
        return {
            type: "Property",
            kind: kind,
            computed: computed,
            method: M instanceof AST_ObjectMethod,
            key: key,
            value: to_moz(M.value),
        };
    });

    def_to_moz(AST_Symbol, function To_Moz_Identifier(M) {
        var def = M.definition();
        return {
            type: "Identifier",
            name: def && def.mangled_name || M.name,
        };
    });

    def_to_moz(AST_Super, function To_Moz_Super() {
        return { type: "Super" };
    });

    def_to_moz(AST_This, function To_Moz_ThisExpression() {
        return { type: "ThisExpression" };
    });

    def_to_moz(AST_NewTarget, function To_Moz_MetaProperty() {
        return {
            type: "MetaProperty",
            meta: {
                type: "Identifier",
                name: "new",
            },
            property: {
                type: "Identifier",
                name: "target",
            },
        };
    });

    def_to_moz(AST_RegExp, function To_Moz_RegExpLiteral(M) {
        var flags = M.value.toString().match(/\/([gimuy]*)$/)[1];
        var value = "/" + M.value.raw_source + "/" + flags;
        return {
            type: "Literal",
            value: value,
            raw: value,
            regex: {
                pattern: M.value.raw_source,
                flags: flags,
            },
        };
    });

    def_to_moz(AST_BigInt, function To_Moz_BigInt(M) {
        var value = M.value;
        return {
            type: "Literal",
            bigint: value.slice(0, -1),
            raw: value,
        };
    });

    function To_Moz_Literal(M) {
        var value = M.value;
        if (typeof value === "number" && (value < 0 || (value === 0 && 1 / value < 0))) {
            return {
                type: "UnaryExpression",
                operator: "-",
                prefix: true,
                argument: {
                    type: "Literal",
                    value: -value,
                    raw: M.start.raw,
                },
            };
        }
        return {
            type: "Literal",
            value: value,
            raw: M.start.raw,
        };
    }
    def_to_moz(AST_Boolean, To_Moz_Literal);
    def_to_moz(AST_Constant, To_Moz_Literal);
    def_to_moz(AST_Null, To_Moz_Literal);

    def_to_moz(AST_Atom, function To_Moz_Atom(M) {
        return {
            type: "Identifier",
            name: String(M.value),
        };
    });

    def_to_moz(AST_Template, function To_Moz_TemplateLiteral_TaggedTemplateExpression(M) {
        var last = M.strings.length - 1;
        var tmpl = {
            type: "TemplateLiteral",
            expressions: M.expressions.map(to_moz),
            quasis: M.strings.map(function(str, index) {
                return {
                    type: "TemplateElement",
                    tail: index == last,
                    value: { raw: str },
                };
            }),
        };
        if (!M.tag) return tmpl;
        return {
            type: "TaggedTemplateExpression",
            tag: to_moz(M.tag),
            quasi: tmpl,
        };
    });

    AST_Block.DEFMETHOD("to_mozilla_ast", AST_BlockStatement.prototype.to_mozilla_ast);
    AST_Hole.DEFMETHOD("to_mozilla_ast", return_null);
    AST_Node.DEFMETHOD("to_mozilla_ast", function() {
        throw new Error("Cannot convert AST_" + this.TYPE);
    });

    /* -----[ tools ]----- */

    function normalize_directives(body) {
        for (var i = 0; i < body.length; i++) {
            var stat = body[i];
            if (!(stat instanceof AST_SimpleStatement)) break;
            var node = stat.body;
            if (!(node instanceof AST_String)) break;
            if (stat.start.pos !== node.start.pos) break;
            body[i] = new AST_Directive(node);
        }
        return body;
    }

    function raw_token(moznode) {
        if (moznode.type == "Literal") {
            return moznode.raw != null ? moznode.raw : moznode.value + "";
        }
    }

    function my_start_token(moznode) {
        var loc = moznode.loc, start = loc && loc.start;
        var range = moznode.range;
        return new AST_Token({
            file    : loc && loc.source,
            line    : start && start.line,
            col     : start && start.column,
            pos     : range ? range[0] : moznode.start,
            endline : start && start.line,
            endcol  : start && start.column,
            endpos  : range ? range[0] : moznode.start,
            raw     : raw_token(moznode),
        });
    }

    function my_end_token(moznode) {
        var loc = moznode.loc, end = loc && loc.end;
        var range = moznode.range;
        return new AST_Token({
            file    : loc && loc.source,
            line    : end && end.line,
            col     : end && end.column,
            pos     : range ? range[1] : moznode.end,
            endline : end && end.line,
            endcol  : end && end.column,
            endpos  : range ? range[1] : moznode.end,
            raw     : raw_token(moznode),
        });
    }

    function read_name(M) {
        return "" + M[M.type == "Identifier" ? "name" : "value"];
    }

    function map(moztype, mytype, propmap) {
        var moz_to_me = [
            "start: my_start_token(M)",
            "end: my_end_token(M)",
        ];
        var me_to_moz = [
            "type: " + JSON.stringify(moztype),
        ];

        if (propmap) propmap.split(/\s*,\s*/).forEach(function(prop) {
            var m = /([a-z0-9$_]+)(=|@|>|%)([a-z0-9$_]+)/i.exec(prop);
            if (!m) throw new Error("Can't understand property map: " + prop);
            var moz = m[1], how = m[2], my = m[3];
            switch (how) {
              case "@":
                moz_to_me.push(my + ": M." + moz + ".map(from_moz)");
                me_to_moz.push(moz + ": M." +  my + ".map(to_moz)");
                break;
              case ">":
                moz_to_me.push(my + ": from_moz(M." + moz + ")");
                me_to_moz.push(moz + ": to_moz(M." + my + ")");
                break;
              case "=":
                moz_to_me.push(my + ": M." + moz);
                me_to_moz.push(moz + ": M." + my);
                break;
              case "%":
                moz_to_me.push(my + ": from_moz(M." + moz + ").body");
                me_to_moz.push(moz + ": to_moz_block(M)");
                break;
              default:
                throw new Error("Can't understand operator in propmap: " + prop);
            }
        });

        MOZ_TO_ME[moztype] = new Function("U2", "my_start_token", "my_end_token", "from_moz", [
            "return function From_Moz_" + moztype + "(M) {",
            "    return new U2.AST_" + mytype.TYPE + "({",
            moz_to_me.join(",\n"),
            "    });",
            "};",
        ].join("\n"))(exports, my_start_token, my_end_token, from_moz);
        def_to_moz(mytype, new Function("to_moz", "to_moz_block", "to_moz_scope", [
            "return function To_Moz_" + moztype + "(M) {",
            "    return {",
            me_to_moz.join(",\n"),
            "    };",
            "};",
        ].join("\n"))(to_moz, to_moz_block, to_moz_scope));
    }

    var FROM_MOZ_STACK = null;

    function from_moz(moz) {
        FROM_MOZ_STACK.push(moz);
        var node = null;
        if (moz) {
            if (!HOP(MOZ_TO_ME, moz.type)) throw new Error("Unsupported type: " + moz.type);
            node = MOZ_TO_ME[moz.type](moz);
        }
        FROM_MOZ_STACK.pop();
        return node;
    }

    function from_moz_alias(moz) {
        return new AST_String({
            start: my_start_token(moz),
            value: read_name(moz),
            end: my_end_token(moz),
        });
    }

    AST_Node.from_mozilla_ast = function(node) {
        var save_stack = FROM_MOZ_STACK;
        FROM_MOZ_STACK = [];
        var ast = from_moz(node);
        FROM_MOZ_STACK = save_stack;
        ast.walk(new TreeWalker(function(node) {
            if (node instanceof AST_LabelRef) {
                for (var level = 0, parent; parent = this.parent(level); level++) {
                    if (parent instanceof AST_Scope) break;
                    if (parent instanceof AST_LabeledStatement && parent.label.name == node.name) {
                        node.thedef = parent.label;
                        break;
                    }
                }
                if (!node.thedef) {
                    var s = node.start;
                    js_error("Undefined label " + node.name, s.file, s.line, s.col, s.pos);
                }
            }
        }));
        return ast;
    };

    function set_moz_loc(mynode, moznode) {
        var start = mynode.start;
        var end = mynode.end;
        if (start.pos != null && end.endpos != null) {
            moznode.range = [start.pos, end.endpos];
        }
        if (start.line) {
            moznode.loc = {
                start: {line: start.line, column: start.col},
                end: end.endline ? {line: end.endline, column: end.endcol} : null,
            };
            if (start.file) {
                moznode.loc.source = start.file;
            }
        }
        return moznode;
    }

    function def_to_moz(mytype, handler) {
        mytype.DEFMETHOD("to_mozilla_ast", function() {
            return set_moz_loc(this, handler(this));
        });
    }

    function to_moz(node) {
        return node != null ? node.to_mozilla_ast() : null;
    }

    function to_moz_alias(alias) {
        return is_identifier_string(alias.value) ? set_moz_loc(alias, {
            type: "Identifier",
            name: alias.value,
        }) : to_moz(alias);
    }

    function to_moz_block(node) {
        return {
            type: "BlockStatement",
            body: node.body.map(to_moz),
        };
    }

    function to_moz_scope(type, node) {
        var body = node.body.map(to_moz);
        if (node.body[0] instanceof AST_SimpleStatement && node.body[0].body instanceof AST_String) {
            body.unshift(to_moz(new AST_EmptyStatement(node.body[0])));
        }
        return {
            type: type,
            body: body,
        };
    }
})();


/***********************************************************************

  A JavaScript tokenizer / parser / beautifier / compressor.
  https://github.com/mishoo/UglifyJS

  -------------------------------- (C) ---------------------------------

                           Author: Mihai Bazon
                         <mihai.bazon@gmail.com>
                       http://mihai.bazon.net/blog

  Distributed under the BSD license:

    Copyright 2012 (c) Mihai Bazon <mihai.bazon@gmail.com>

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:

        * Redistributions of source code must retain the above
          copyright notice, this list of conditions and the following
          disclaimer.

        * Redistributions in binary form must reproduce the above
          copyright notice, this list of conditions and the following
          disclaimer in the documentation and/or other materials
          provided with the distribution.

    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER “AS IS” AND ANY
    EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
    PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
    OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
    PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
    PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
    THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
    TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
    THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
    SUCH DAMAGE.

 ***********************************************************************/

"use strict";

function get_builtins() {
    var names = new Dictionary();
    // constants
    [
        "NaN",
        "null",
        "true",
        "false",
        "Infinity",
        "-Infinity",
        "undefined",
    ].forEach(add);
    // global functions
    [
        "encodeURI",
        "encodeURIComponent",
        "escape",
        "eval",
        "decodeURI",
        "decodeURIComponent",
        "isFinite",
        "isNaN",
        "parseFloat",
        "parseInt",
        "unescape",
    ].forEach(add);
    // global constructors & objects
    var global = Function("return this")();
    [
        "Array",
        "ArrayBuffer",
        "Atomics",
        "BigInt",
        "Boolean",
        "console",
        "DataView",
        "Date",
        "Error",
        "Function",
        "Int8Array",
        "Intl",
        "JSON",
        "Map",
        "Math",
        "Number",
        "Object",
        "Promise",
        "Proxy",
        "Reflect",
        "RegExp",
        "Set",
        "String",
        "Symbol",
        "WebAssembly",
    ].forEach(function(name) {
        add(name);
        var ctor = global[name];
        if (!ctor) return;
        Object.getOwnPropertyNames(ctor).map(add);
        if (typeof ctor != "function") return;
        if (ctor.__proto__) Object.getOwnPropertyNames(ctor.__proto__).map(add);
        if (ctor.prototype) Object.getOwnPropertyNames(ctor.prototype).map(add);
        try {
            Object.getOwnPropertyNames(new ctor()).map(add);
        } catch (e) {
            try {
                Object.getOwnPropertyNames(ctor()).map(add);
            } catch (e) {}
        }
    });
    return (get_builtins = function() {
        return names.clone();
    })();

    function add(name) {
        names.set(name, true);
    }
}

function reserve_quoted_keys(ast, reserved) {
    ast.walk(new TreeWalker(function(node) {
        if (node instanceof AST_ClassProperty
            || node instanceof AST_DestructuredKeyVal
            || node instanceof AST_ObjectProperty) {
            if (node.key instanceof AST_Node) {
                addStrings(node.key, add);
            } else if (node.start && node.start.quote) {
                add(node.key);
            }
        } else if (node instanceof AST_Dot) {
            if (node.quoted) add(node.property);
        } else if (node instanceof AST_Sub) {
            addStrings(node.property, add);
        }
    }));

    function add(name) {
        push_uniq(reserved, name);
    }
}

function addStrings(node, add) {
    if (node instanceof AST_Conditional) {
        addStrings(node.consequent, add);
        addStrings(node.alternative, add);
    } else if (node instanceof AST_Sequence) {
        addStrings(node.tail_node(), add);
    } else if (node instanceof AST_String) {
        add(node.value);
    }
}

function mangle_properties(ast, options) {
    options = defaults(options, {
        builtins: false,
        cache: null,
        debug: false,
        domprops: false,
        keep_quoted: false,
        regex: null,
        reserved: null,
    }, true);

    var reserved = options.builtins ? new Dictionary() : get_builtins();
    if (!options.domprops && typeof domprops !== "undefined") domprops.forEach(function(name) {
        reserved.set(name, true);
    });
    if (Array.isArray(options.reserved)) options.reserved.forEach(function(name) {
        reserved.set(name, true);
    });

    var cname = -1;
    var cache;
    if (options.cache) {
        cache = options.cache.props;
        cache.each(function(name) {
            reserved.set(name, true);
        });
    } else {
        cache = new Dictionary();
    }

    var regex = options.regex;

    // note debug is either false (disabled), or a string of the debug suffix to use (enabled).
    // note debug may be enabled as an empty string, which is falsy. Also treat passing 'true'
    // the same as passing an empty string.
    var debug = options.debug !== false;
    var debug_suffix;
    if (debug) debug_suffix = options.debug === true ? "" : options.debug;

    var names_to_mangle = new Dictionary();
    var unmangleable = reserved.clone();

    // step 1: find candidates to mangle
    ast.walk(new TreeWalker(function(node) {
        if (node.TYPE == "Call") {
            var exp = node.expression;
            if (exp instanceof AST_Dot) switch (exp.property) {
              case "defineProperty":
              case "getOwnPropertyDescriptor":
                if (node.args.length < 2) break;
                exp = exp.expression;
                if (!(exp instanceof AST_SymbolRef)) break;
                if (exp.name != "Object") break;
                if (!exp.definition().undeclared) break;
                addStrings(node.args[1], add);
                break;
              case "hasOwnProperty":
                if (node.args.length < 1) break;
                addStrings(node.args[0], add);
                break;
            }
        } else if (node instanceof AST_ClassProperty
            || node instanceof AST_DestructuredKeyVal
            || node instanceof AST_ObjectProperty) {
            if (node.key instanceof AST_Node) {
                addStrings(node.key, add);
            } else {
                add(node.key);
            }
        } else if (node instanceof AST_Dot) {
            if (is_lhs(node, this.parent())) add(node.property);
        } else if (node instanceof AST_Sub) {
            if (is_lhs(node, this.parent())) addStrings(node.property, add);
        }
    }));

    // step 2: renaming properties
    ast.walk(new TreeWalker(function(node) {
        if (node instanceof AST_Binary) {
            if (node.operator == "in") mangleStrings(node.left);
        } else if (node.TYPE == "Call") {
            var exp = node.expression;
            if (exp instanceof AST_Dot) switch (exp.property) {
              case "defineProperty":
              case "getOwnPropertyDescriptor":
                if (node.args.length < 2) break;
                exp = exp.expression;
                if (!(exp instanceof AST_SymbolRef)) break;
                if (exp.name != "Object") break;
                if (!exp.definition().undeclared) break;
                mangleStrings(node.args[1]);
                break;
              case "hasOwnProperty":
                if (node.args.length < 1) break;
                mangleStrings(node.args[0]);
                break;
            }
        } else if (node instanceof AST_ClassProperty
            || node instanceof AST_DestructuredKeyVal
            || node instanceof AST_ObjectProperty) {
            if (node.key instanceof AST_Node) {
                mangleStrings(node.key);
            } else {
                node.key = mangle(node.key);
            }
        } else if (node instanceof AST_Dot) {
            node.property = mangle(node.property);
        } else if (node instanceof AST_Sub) {
            if (!options.keep_quoted) mangleStrings(node.property);
        }
    }));

    // only function declarations after this line

    function can_mangle(name) {
        if (unmangleable.has(name)) return false;
        if (/^-?[0-9]+(\.[0-9]+)?(e[+-][0-9]+)?$/.test(name)) return false;
        return true;
    }

    function should_mangle(name) {
        if (reserved.has(name)) {
            AST_Node.info("Preserving reserved property {this}", name);
            return false;
        }
        if (regex && !regex.test(name)) {
            AST_Node.info("Preserving excluded property {this}", name);
            return false;
        }
        return cache.has(name) || names_to_mangle.has(name);
    }

    function add(name) {
        if (can_mangle(name)) names_to_mangle.set(name, true);
        if (!should_mangle(name)) unmangleable.set(name, true);
    }

    function mangle(name) {
        if (!should_mangle(name)) return name;
        var mangled = cache.get(name);
        if (!mangled) {
            if (debug) {
                // debug mode: use a prefix and suffix to preserve readability, e.g. o.foo ---> o._$foo$NNN_.
                var debug_mangled = "_$" + name + "$" + debug_suffix + "_";
                if (can_mangle(debug_mangled)) mangled = debug_mangled;
            }
            // either debug mode is off, or it is on and we could not use the mangled name
            if (!mangled) do {
                mangled = base54(++cname);
            } while (!can_mangle(mangled));
            if (/^#/.test(name)) mangled = "#" + mangled;
            cache.set(name, mangled);
        }
        AST_Node.info("Mapping property {name} to {mangled}", {
            mangled: mangled,
            name: name,
        });
        return mangled;
    }

    function mangleStrings(node) {
        if (node instanceof AST_Sequence) {
            mangleStrings(node.tail_node());
        } else if (node instanceof AST_String) {
            node.value = mangle(node.value);
        } else if (node instanceof AST_Conditional) {
            mangleStrings(node.consequent);
            mangleStrings(node.alternative);
        }
    }
}


"use strict";

var to_ascii, to_base64;
if (typeof Buffer == "undefined") {
    to_ascii = atob;
    to_base64 = btoa;
} else if (typeof Buffer.alloc == "undefined") {
    to_ascii = function(b64) {
        return new Buffer(b64, "base64").toString();
    };
    to_base64 = function(str) {
        return new Buffer(str).toString("base64");
    };
} else {
    to_ascii = function(b64) {
        return Buffer.from(b64, "base64").toString();
    };
    to_base64 = function(str) {
        return Buffer.from(str).toString("base64");
    };
}

function read_source_map(name, toplevel) {
    var comments = toplevel.end.comments_after;
    for (var i = comments.length; --i >= 0;) {
        var comment = comments[i];
        if (comment.type != "comment1") break;
        var match = /^# ([^\s=]+)=(\S+)\s*$/.exec(comment.value);
        if (!match) break;
        if (match[1] == "sourceMappingURL") {
            match = /^data:application\/json(;.*?)?;base64,([^,]+)$/.exec(match[2]);
            if (!match) break;
            return to_ascii(match[2]);
        }
    }
    AST_Node.warn("inline source map not found: {name}", {
        name: name,
    });
}

function parse_source_map(content) {
    try {
        return JSON.parse(content);
    } catch (ex) {
        throw new Error("invalid input source map: " + content);
    }
}

function set_shorthand(name, options, keys) {
    keys.forEach(function(key) {
        if (options[key]) {
            if (typeof options[key] != "object") options[key] = {};
            if (!(name in options[key])) options[key][name] = options[name];
        }
    });
}

function init_cache(cache) {
    if (!cache) return;
    if (!("props" in cache)) {
        cache.props = new Dictionary();
    } else if (!(cache.props instanceof Dictionary)) {
        cache.props = Dictionary.fromObject(cache.props);
    }
}

function to_json(cache) {
    return {
        props: cache.props.toObject()
    };
}

function minify(files, options) {
    try {
        options = defaults(options, {
            annotations: undefined,
            compress: {},
            enclose: false,
            expression: false,
            ie: false,
            ie8: false,
            keep_fargs: false,
            keep_fnames: false,
            mangle: {},
            module: false,
            nameCache: null,
            output: {},
            parse: {},
            rename: undefined,
            sourceMap: false,
            timings: false,
            toplevel: !!(options && options["module"]),
            v8: false,
            validate: false,
            warnings: false,
            webkit: false,
            wrap: false,
        }, true);
        if (options.validate) AST_Node.enable_validation();
        var timings = options.timings && { start: Date.now() };
        if (options.annotations !== undefined) set_shorthand("annotations", options, [ "compress", "output" ]);
        if (options.expression) set_shorthand("expression", options, [ "compress", "parse" ]);
        if (options.ie8) options.ie = options.ie || options.ie8;
        if (options.ie) set_shorthand("ie", options, [ "compress", "mangle", "output", "rename" ]);
        if (options.keep_fargs) set_shorthand("keep_fargs", options, [ "compress", "mangle", "rename" ]);
        if (options.keep_fnames) set_shorthand("keep_fnames", options, [ "compress", "mangle", "rename" ]);
        if (options.module) set_shorthand("module", options, [ "compress", "parse" ]);
        if (options.toplevel) set_shorthand("toplevel", options, [ "compress", "mangle", "rename" ]);
        if (options.v8) set_shorthand("v8", options, [ "mangle", "output", "rename" ]);
        if (options.webkit) set_shorthand("webkit", options, [ "compress", "mangle", "output", "rename" ]);
        var quoted_props;
        if (options.mangle) {
            options.mangle = defaults(options.mangle, {
                cache: options.nameCache && (options.nameCache.vars || {}),
                eval: false,
                ie: false,
                keep_fargs: false,
                keep_fnames: false,
                properties: false,
                reserved: [],
                toplevel: false,
                v8: false,
                webkit: false,
            }, true);
            if (options.mangle.properties) {
                if (typeof options.mangle.properties != "object") {
                    options.mangle.properties = {};
                }
                if (options.mangle.properties.keep_quoted) {
                    quoted_props = options.mangle.properties.reserved;
                    if (!Array.isArray(quoted_props)) quoted_props = [];
                    options.mangle.properties.reserved = quoted_props;
                }
                if (options.nameCache && !("cache" in options.mangle.properties)) {
                    options.mangle.properties.cache = options.nameCache.props || {};
                }
            }
            init_cache(options.mangle.cache);
            init_cache(options.mangle.properties.cache);
        }
        if (options.rename === undefined) options.rename = options.compress && options.mangle;
        if (options.sourceMap) {
            options.sourceMap = defaults(options.sourceMap, {
                content: null,
                filename: null,
                includeSources: false,
                names: true,
                root: null,
                url: null,
            }, true);
        }
        var warnings = [];
        if (options.warnings) AST_Node.log_function(function(warning) {
            warnings.push(warning);
        }, options.warnings == "verbose");
        if (timings) timings.parse = Date.now();
        var toplevel;
        options.parse = options.parse || {};
        if (files instanceof AST_Node) {
            toplevel = files;
        } else {
            if (typeof files == "string") files = [ files ];
            options.parse.toplevel = null;
            var source_map_content = options.sourceMap && options.sourceMap.content;
            if (typeof source_map_content == "string" && source_map_content != "inline") {
                source_map_content = parse_source_map(source_map_content);
            }
            if (source_map_content) options.sourceMap.orig = Object.create(null);
            for (var name in files) if (HOP(files, name)) {
                options.parse.filename = name;
                options.parse.toplevel = toplevel = parse(files[name], options.parse);
                if (source_map_content == "inline") {
                    var inlined_content = read_source_map(name, toplevel);
                    if (inlined_content) options.sourceMap.orig[name] = parse_source_map(inlined_content);
                } else if (source_map_content) {
                    options.sourceMap.orig[name] = source_map_content;
                }
            }
        }
        if (options.parse.expression) toplevel = toplevel.wrap_expression();
        if (quoted_props) reserve_quoted_keys(toplevel, quoted_props);
        [ "enclose", "wrap" ].forEach(function(action) {
            var option = options[action];
            if (!option) return;
            var orig = toplevel.print_to_string().slice(0, -1);
            toplevel = toplevel[action](option);
            files[toplevel.start.file] = toplevel.print_to_string().replace(orig, "");
        });
        if (options.validate) toplevel.validate_ast();
        if (timings) timings.rename = Date.now();
        if (options.rename) {
            toplevel.figure_out_scope(options.rename);
            toplevel.expand_names(options.rename);
        }
        if (timings) timings.compress = Date.now();
        if (options.compress) {
            toplevel = new Compressor(options.compress).compress(toplevel);
            if (options.validate) toplevel.validate_ast();
        }
        if (timings) timings.scope = Date.now();
        if (options.mangle) toplevel.figure_out_scope(options.mangle);
        if (timings) timings.mangle = Date.now();
        if (options.mangle) {
            toplevel.compute_char_frequency(options.mangle);
            toplevel.mangle_names(options.mangle);
        }
        if (timings) timings.properties = Date.now();
        if (quoted_props) reserve_quoted_keys(toplevel, quoted_props);
        if (options.mangle && options.mangle.properties) mangle_properties(toplevel, options.mangle.properties);
        if (options.parse.expression) toplevel = toplevel.unwrap_expression();
        if (timings) timings.output = Date.now();
        var result = {};
        var output = defaults(options.output, {
            ast: false,
            code: true,
        });
        if (output.ast) result.ast = toplevel;
        if (output.code) {
            if (options.sourceMap) {
                output.source_map = SourceMap(options.sourceMap);
                if (options.sourceMap.includeSources) {
                    if (files instanceof AST_Toplevel) {
                        throw new Error("original source content unavailable");
                    } else for (var name in files) if (HOP(files, name)) {
                        output.source_map.setSourceContent(name, files[name]);
                    }
                }
            }
            delete output.ast;
            delete output.code;
            var stream = OutputStream(output);
            toplevel.print(stream);
            result.code = stream.get();
            if (options.sourceMap) {
                result.map = output.source_map.toString();
                var url = options.sourceMap.url;
                if (url) {
                    result.code = result.code.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "");
                    if (url == "inline") {
                        result.code += "\n//# sourceMappingURL=data:application/json;charset=utf-8;base64," + to_base64(result.map);
                    } else {
                        result.code += "\n//# sourceMappingURL=" + url;
                    }
                }
            }
        }
        if (options.nameCache && options.mangle) {
            if (options.mangle.cache) options.nameCache.vars = to_json(options.mangle.cache);
            if (options.mangle.properties && options.mangle.properties.cache) {
                options.nameCache.props = to_json(options.mangle.properties.cache);
            }
        }
        if (timings) {
            timings.end = Date.now();
            result.timings = {
                parse: 1e-3 * (timings.rename - timings.parse),
                rename: 1e-3 * (timings.compress - timings.rename),
                compress: 1e-3 * (timings.scope - timings.compress),
                scope: 1e-3 * (timings.mangle - timings.scope),
                mangle: 1e-3 * (timings.properties - timings.mangle),
                properties: 1e-3 * (timings.output - timings.properties),
                output: 1e-3 * (timings.end - timings.output),
                total: 1e-3 * (timings.end - timings.start)
            };
        }
        if (warnings.length) {
            result.warnings = warnings;
        }
        return result;
    } catch (ex) {
        return { error: ex };
    } finally {
        AST_Node.log_function();
        AST_Node.disable_validation();
    }
}


exports["Dictionary"] = Dictionary;
exports["is_statement"] = is_statement;
exports["List"] = List;
exports["minify"] = minify;
exports["parse"] = parse;
exports["push_uniq"] = push_uniq;
exports["TreeTransformer"] = TreeTransformer;
exports["TreeWalker"] = TreeWalker;



exports.describe_ast = function describe_ast() {
    var out = OutputStream({ beautify: true });
    doitem(AST_Node);
    return out.get() + "\n";

    function doitem(ctor) {
        out.print("AST_" + ctor.TYPE);
        var props = ctor.SELF_PROPS.filter(function(prop) {
            return !/^\$/.test(prop);
        });
        if (props.length > 0) {
            out.space();
            out.with_parens(function() {
                props.forEach(function(prop, i) {
                    if (i) out.space();
                    out.print(prop);
                });
            });
        }
        if (ctor.documentation) {
            out.space();
            out.print_string(ctor.documentation);
        }
        if (ctor.SUBCLASSES.length > 0) {
            out.space();
            out.with_block(function() {
                ctor.SUBCLASSES.sort(function(a, b) {
                    return a.TYPE < b.TYPE ? -1 : 1;
                }).forEach(function(ctor, i) {
                    out.indent();
                    doitem(ctor);
                    out.newline();
                });
            });
        }
    }
};

function infer_options(options) {
    var result = exports.minify("", options);
    return result.error && result.error.defs;
}

exports.default_options = function() {
    var defs = infer_options({ 0: 0 });
    Object.keys(defs).forEach(function(component) {
        var options = {};
        options[component] = { 0: 0 };
        if (options = infer_options(options)) {
            defs[component] = options;
        }
    });
    return defs;
};
