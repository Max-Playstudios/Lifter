﻿/**
 * Copyright 2014 Francesco Camarlinghi
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * 	http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// TODO:
// - Property: grouped (complete support for creating grouped layers).
// - Property: kind (complete support for colorLookup).
// - Property: merge kind and type and add custom LifterLayerKind enumeration.
// - Property: textItem.
// - Property: linkedLayers.
// - Method: move layer!

; (function () {
    log.log("Lifter.layers loading...");
    /**
     * @namespace
     * @alias Lifter.layers
     */
    var layers = {};

    /** Utility object used to temporary hold data during heavy operations. @private */
    var _cache = {};

    /** Sets the passed layer as active and executes the specified callback. @private */
    function _wrapSwitchActive(layerId, callback, context)
    {
        // Set active layer to layerId
        // If we do not have a valid layerId we assume we want to target
        // the currently active layer
        if (typeof layerId === 'number' && layers.prop('layerId') !== layerId)
            layers.stack.makeActive(layerId);

        // Execute code
        callback.call(context);
    }

    /** Gets a ActionDescriptor holding all the properties needed for the Make Layer action. @private */
    function _getMakeLayerDescriptor(name, opacity, blendMode, color)
    {
        // Set layer set properties
        var desc = new ActionDescriptor();

        // Name
        if (typeof name === 'string' && name.length)
            desc.putString(c2id('Nm  '), name);

        // Opacity
        typeof opacity === 'number' || (opacity = 100.0);
        desc.putUnitDouble(c2id('Opct'), c2id('#Prc'), opacity);

        // Blend mode
        (blendMode && blendMode.valueOf) || (blendMode = BlendMode.NORMAL);
        desc.putEnumerated(c2id('Md  '), c2id('BlnM'), _ensureLifterBlendMode(blendMode).valueOf());

        // Color
        (color && color.valueOf) || (color = LayerColor.NONE);
        desc.putEnumerated(c2id('Clr '), c2id('Clr '), color.valueOf());

        return desc;
    }

    /** Puts the correct value in 'ref' to the get the layer specified by LayerId. @private */
    function _getLayerIdRef(layerId, ref)
    {
        if (typeof layerId !== 'number' || layerId === 0)
        {
            // If layerId is not passed, assume current layer
            // If layerId is 0 we're targeting the background layer in a document where background is the only layer
            // Use enumeration to get the background as getting it using LayerId directly will throw an error
            ref.putEnumerated(c2id('Lyr '), c2id('Ordn'), c2id('Trgt'));
        }
        else
        {
            // Use layerId directly
            ref.putIdentifier(c2id('Lyr '), layerId);
        }
    }

    /** Puts the correct value in 'ref' to the get the layer specified by ItemIndex. @private */
    function _getItemIndexRef(itemIndex, ref)
    {
        if (typeof itemIndex !== 'number')
        {
            // If itemIndex is not passed, assume current layer
            ref.putEnumerated(c2id('Lyr '), c2id('Ordn'), c2id('Trgt'));
        }
        else if (layers.count() === 0)
        {
            // Layer count is zero if the background layer is the only layer
            // present in the current document
            if (itemIndex !== 1)
                throw new Error(['Could not find layer with ItemIndex "', itemIndex, '".'].join(''));

            // Use enumeration to get the background as getting it using
            // ItemIndex directly will throw an error
            ref.putEnumerated(c2id('Lyr '), c2id('Ordn'), c2id('Trgt'));
        }
        else
        {
            // Check if document has a background layer and get correct ItemIndex
            if (layers.hasBackground())
                itemIndex--;

            // Use correct layer itemIndex
            ref.putIndex(c2id('Lyr '), itemIndex);
        }

        return ref;
    }

    /** Traverse layer stack in the specified direction, returning the according layer identifier. @private */
    function _getStackId(direction)
    {
        // If only the background layer is present in document, just return background layerId
        if (layers.count() === 0)
        {
            return 0;
        }
        else
        {
            var ref = new ActionReference();
            ref.putProperty(c2id('Prpr'), c2id('LyrI'));
            ref.putEnumerated(c2id('Lyr '), c2id('Ordn'), direction);
            return executeActionGet(ref).getInteger(c2id('LyrI'));
        }

        return layers;
    }

    /** Traverse layer stack in the specified direction, selecting the according layer. @private */
    function _traverseStack(direction)
    {
        // No need of setting the background layer active, it always is
        if (layers.count() === 0)
            return;

            layers.stack.makeActive(_getStackId(direction));
        return layers;
    }


    /**
     * retrieve or mutate basic ActionReference from id or active layer
     *
     * @param {Number} [layerId]
     * @param {ActionReference} [ref]   existing ActionReference to mutate
     * @returns {ActionReference}
     */
    layers.ref = function (layerId, ref) {
        ref = ref|| new ActionReference();
        _getLayerIdRef(layerId, ref);
        return ref;
    };


    /**
     * retrieve or mutate basic ActionDescriptor from id or active layer
     *
     * @param {Number} [layerId]
     * @param {ActionReference} [ref]   existing ActionReference to use or mutate
     * @param {ActionDescriptor} [desc]   existing ActionDescriptor to mutate
     * @returns {ActionDescriptor}
     */
    layers.desc = function (layerId, ref, desc) {
        desc = desc|| new ActionDescriptor();
        desc = executeActionGet(layers.ref(layerId,ref));
        return desc;
    };


    /** Supported layer properties. This is public so that additional properties can be added at runtime. */
    /**
     * @namespace
     * @alias Lifter.layers.supportedProperties
     */
    layers.supportedProperties = {
        'itemIndex': {
            typeId: c2id('ItmI'),
            type: DescValueType.INTEGERTYPE,
            set: function (prop, layerId, value)
            {
                if (layers.prop(layerId, 'isBackgroundLayer'))
                    throw new Error('Unable to set ItemIndex on background layer.');

                // Setting itemIndex moves the layer
                var ref = new ActionReference();
                _getLayerIdRef(layerId, ref);

                var ref2 = new ActionReference();
                ref2.putIndex(c2id('Lyr '), value);

                var desc = new ActionDescriptor();
                desc.putReference(c2id('null'), ref);
                desc.putReference(c2id('T   '), ref2);
                desc.putBoolean(c2id('Adjs'), false);
                desc.putInteger(c2id('Vrsn'), 5);
                executeAction(c2id('move'), desc, _dialogModesNo);
            },
        },
        'layerId': { typeId: c2id('LyrI'), type: DescValueType.INTEGERTYPE, set: false, },

        'name': {
            typeId: c2id('Nm  '),
            type: DescValueType.STRINGTYPE,
            defaultValue: 'Layer',
            set: function (prop, layerId, value)
            {
                // Target layer must be active to change its name
                _wrapSwitchActive(layerId, function ()
                {
                    var ref = new ActionReference();
                    ref.putEnumerated(c2id('Lyr '), c2id('Ordn'), c2id('Trgt'));
                    var desc = new ActionDescriptor();
                    desc.putReference(c2id('null'), ref);
                    var desc2 = new ActionDescriptor();
                    desc2.putString(prop.typeId, value);
                    desc.putObject(c2id('T   '), c2id('Lyr '), desc2);
                    executeAction(c2id('setd'), desc, _dialogModesNo);
                });
            },
        },

        'color': {
            typeId: c2id('Clr '),
            type: DescValueType.ENUMERATEDTYPE,
            defaultValue: LayerColor.NONE,
            get: function (prop, layerId, desc)
            {
                // Parse color
                return Enumeration.fromValue(LayerColor, desc.getEnumerationValue(prop.typeId));
            },
            set: function (prop, layerId, value)
            {
                // Target layer must be active to change its color
                _wrapSwitchActive(layerId, function ()
                {
                    var ref = new ActionReference();
                    _getLayerIdRef(layerId, ref);
                    var desc = new ActionDescriptor();
                    desc.putReference(c2id('null'), ref);
                    var desc2 = new ActionDescriptor();
                    desc2.putEnumerated(c2id('Clr '), c2id('Clr '), value.valueOf());
                    desc.putObject(c2id('T   '), c2id('Lyr '), desc2);
                    executeAction(c2id('setd'), desc, _dialogModesNo);
                });
            },
        },

        'visible': {
            typeId: c2id('Vsbl'),
            type: DescValueType.BOOLEANTYPE,
            defaultValue: true,
            set: function (prop, layerId, value)
            {
                var ref = new ActionReference();
                _getLayerIdRef(layerId, ref);
                var list = new ActionList();
                list.putReference(ref);
                var desc = new ActionDescriptor();
                desc.putList(c2id('null'), list);

                if (value)
                    executeAction(c2id('Shw '), desc, _dialogModesNo);
                else
                    executeAction(c2id('Hd  '), desc, _dialogModesNo);
            },
        },

        'opacity': {
            typeId: c2id('Opct'),
            type: DescValueType.UNITDOUBLE,
            defaultValue: 100.0,
            get: function (prop, layerId, desc)
            {
                return _byteToPercent(desc.getInteger(prop.typeId));
            },
            set: function (prop, layerId, value)
            {
                // Layer must be visible to be able to apply opacity
                // or an error is thrown by AM
                var oldVisible = layers.prop(layerId, 'visible');

                if (!oldVisible)
                    layers.prop(layerId, 'visible', true);

                // Apply new opacity
                var ref = new ActionReference();
                _getLayerIdRef(layerId, ref);
                var desc = new ActionDescriptor();
                desc.putReference(c2id('null'), ref);
                var desc2 = new ActionDescriptor();
                desc2.putUnitDouble(prop.typeId, c2id('#Prc'), value);
                desc.putObject(c2id('T   '), c2id('Lyr '), desc2);
                executeAction(c2id('setd'), desc, _dialogModesNo);

                // Reset visibility
                if (!oldVisible)
                    layers.prop(layerId, 'visible', false);
            },
        },

        'fillOpacity': {
            typeId: s2id('fillOpacity'),
            type: DescValueType.UNITDOUBLE,
            defaultValue: 100.0,
            get: function (prop, layerId, desc)
            {
                return _byteToPercent(desc.getInteger(prop.typeId));
            },
            set: function (prop, layerId, value)
            {
                if (layers.prop(layerId, 'type') !== LayerType.CONTENT)
                    throw new Error('Applying fill opacity to layer sets is not supported by Action Manager (nor by DOM).');

                // Layer must be visible to be able to apply fillOpacity
                // or an error is thrown by AM
                var oldVisible = layers.prop(layerId, 'visible');

                if (!oldVisible)
                    layers.prop(layerId, 'visible', true);

                // Apply new fillOpacity
                var ref = new ActionReference();
                _getLayerIdRef(layerId, ref);
                var desc = new ActionDescriptor();
                desc.putReference(c2id('null'), ref);
                var desc2 = new ActionDescriptor();
                desc2.putUnitDouble(prop.typeId, c2id('#Prc'), value);
                desc.putObject(c2id('T   '), c2id('Lyr '), desc2);
                executeAction(c2id('setd'), desc, _dialogModesNo);

                // Reset visibility
                if (!oldVisible)
                    layers.prop(layerId, 'visible', false);
            },
        },

        'blendMode': {
            typeId: c2id('Md  '),
            type: DescValueType.ENUMERATEDTYPE,
            defaultValue: BlendMode.NORMAL,
            get: function (prop, layerId, desc)
            {
                // Parse blend mode
                return Enumeration.fromValue(LifterBlendMode, desc.getEnumerationValue(prop.typeId));
            },
            set: function (prop, layerId, value)
            {
                // Passthrough is unsupported on layers, but does not throw an error,
                // thus no checks are implemented
                // Get value from LifterBlendMode enum
                value = _ensureLifterBlendMode(value).valueOf();

                // Set blend mode
                var ref = new ActionReference();
                _getLayerIdRef(layerId, ref);
                var desc = new ActionDescriptor();
                desc.putReference(c2id('null'), ref);
                var desc2 = new ActionDescriptor();
                desc2.putEnumerated(prop.typeId, c2id('BlnM'), value);
                desc.putObject(c2id('T   '), c2id('Lyr '), desc2);
                executeAction(c2id('setd'), desc, _dialogModesNo);
            },
        },

        'type': {
            typeId: s2id('layerSection'),
            type: DescValueType.ENUMERATEDTYPE,
            get: function (prop, layerId, desc)
            {
                var type = typeIDToStringID(desc.getEnumerationValue(prop.typeId));

                switch (type)
                {
                    case 'layerSectionStart': return LayerType.SETSTART;
                    case 'layerSectionEnd': return LayerType.SETEND;
                    case 'layerSectionContent': return LayerType.CONTENT;
                    default: throw new Error(['Unsupported layer type encountered: "', type, '".'].join(''));
                }
            },
            set: false,
        },

        'kind': {
            get: function (prop, layerId, desc)
            {
                // Based on:
                // http://www.ps-scripts.com/bb/viewtopic.php?f=9&t=5656
                // Throw error if layer set
                if (layers.prop(layerId, 'type') !== LayerType.CONTENT)
                    throw new Error('Unable to get "kind" for layer sets.');

                if (desc.hasKey(s2id('textKey')))
                    return LayerKind.TEXT;

                // Includes LayerKind.VIDEO
                if (desc.hasKey(s2id('smartObject')))
                    return LayerKind.SMARTOBJECT;

                if (desc.hasKey(s2id('layer3D')))
                    return LayerKind.LAYER3D;

                var adjustmentType = s2id('adjustment');

                if (desc.hasKey(adjustmentType))
                {
                    var adjustmentKind = typeIDToStringID(desc.getList(adjustmentType).getClass(0));

                    switch (adjustmentKind)
                    {
                        case 'photoFilter': return LayerKind.PHOTOFILTER;
                        case 'solidColorLayer': return LayerKind.SOLIDFILL;
                        case 'gradientMapClass': return LayerKind.GRADIENTMAP;
                        case 'gradientMapLayer': return LayerKind.GRADIENTFILL;
                        case 'hueSaturation': return LayerKind.HUESATURATION;
                        case 'colorLookup': return; // This does not exist and throws an error
                        case 'colorBalance': return LayerKind.COLORBALANCE;
                        case 'patternLayer': return LayerKind.PATTERNFILL;
                        case 'invert': return LayerKind.INVERSION;
                        case 'posterization': return LayerKind.POSTERIZE;
                        case 'thresholdClassEvent': return LayerKind.THRESHOLD;
                        case 'blackAndWhite': return LayerKind.BLACKANDWHITE;
                        case 'selectiveColor': return LayerKind.SELECTIVECOLOR;
                        case 'vibrance': return LayerKind.VIBRANCE;
                        case 'brightnessEvent': return LayerKind.BRIGHTNESSCONTRAST;
                        case 'channelMixer': return LayerKind.CHANNELMIXER;
                        case 'curves': return LayerKind.CURVES;
                        case 'exposure': return LayerKind.EXPOSURE;

                        default:
                            // If none of the above, return adjustment kind as string
                            return adjustmentKind;
                    }
                }

                // If we get here normal should be the only choice left
                return LayerKind.NORMAL;
            },
            set: false,
        },

        'bounds': {
            typeId: s2id('bounds'),
            type: DescValueType.OBJECTTYPE,
            get: function (prop, layerId, desc)
            {
                var bounds = desc.getObjectValue(prop.typeId);

                // LayerBounds seems to be always saved in pixels,
                // but unit is loaded from document anyways
                return new LayerBounds(
                        bounds.getUnitDoubleValue(c2id('Top ')),
                        bounds.getUnitDoubleValue(c2id('Left')),
                        bounds.getUnitDoubleValue(c2id('Btom')),
                        bounds.getUnitDoubleValue(c2id('Rght')),
                        bounds.getUnitDoubleType(c2id('Top '))
                    );
            },
            set: false,
        },

        'boundsNoEffects': {
            typeId: s2id('boundsNoEffects'),
            type: DescValueType.OBJECTTYPE,
            get: function (prop, layerId, desc)
            {
                var bounds = desc.getObjectValue(prop.typeId);

                // LayerBounds seems to be always saved in pixels,
                // but unit is loaded from document anyways
                return new LayerBounds(
                        bounds.getUnitDoubleValue(c2id('Top ')),
                        bounds.getUnitDoubleValue(c2id('Left')),
                        bounds.getUnitDoubleValue(c2id('Btom')),
                        bounds.getUnitDoubleValue(c2id('Rght')),
                        bounds.getUnitDoubleType(c2id('Top '))
                    );
            },
            set: false,
        },

        'boundsNoMask': {
            typeId: s2id('boundsNoMask'),
            type: DescValueType.OBJECTTYPE,
            get: function (prop, layerId, desc)
            {
                var bounds = desc.getObjectValue(prop.typeId);

                // LayerBounds seems to be always saved in pixels,
                // but unit is loaded from document anyways
                return new LayerBounds(
                        bounds.getUnitDoubleValue(c2id('Top ')),
                        bounds.getUnitDoubleValue(c2id('Left')),
                        bounds.getUnitDoubleValue(c2id('Btom')),
                        bounds.getUnitDoubleValue(c2id('Rght')),
                        bounds.getUnitDoubleType(c2id('Top '))
                    );
            },
            set: false,
        },

        // NOTE: this does not indicate that a layer is a group or set. use 'type' prop for that.
        'group': { typeId: c2id('Grup'), type: DescValueType.BOOLEANTYPE, set: false, },

        'hasLayerMask': { typeId: s2id('hasUserMask'), type: DescValueType.BOOLEANTYPE, set: false, },

        'layerMaskEnabled': {
            typeId: s2id('userMaskEnabled'),
            type: DescValueType.BOOLEANTYPE,
            defaultValue: true,
            get: function (prop, layerId, desc)
            {
                if (!layers.prop(layerId, 'hasLayerMask'))
                    throw new Error('Unable to get layer mask enabled: layer does not have a layer mask applied.');

                return desc.getBoolean(prop.typeId);
            },
            set: function (prop, layerId, value)
            {
                if (!layers.prop(layerId, 'hasLayerMask'))
                    throw new Error('Unable to set layer mask enabled: layer does not have a layer mask applied.');

                var desc = new ActionDescriptor();
                var ref = layers.ref(layerId);
                desc.putReference( c2id('null'), ref );
                    var descToggle = new ActionDescriptor();
                    descToggle.putBoolean( c2id('UsrM'), value );
                desc.putObject( c2id('T   '), c2id('Lyr '), descToggle );
                executeAction( c2id('setd'), desc, DialogModes.NO );}
            },

        'layerMaskLinked': {
            typeId: s2id('userMaskLinked'),
            type: DescValueType.BOOLEANTYPE,
            defaultValue: true,
            get: function (prop, layerId, desc)
            {
                if (!layers.prop(layerId, 'hasLayerMask'))
                    throw new Error('Unable to get layer mask Linked: layer does not have a layer mask applied.');

                return desc.getBoolean(prop.typeId);
            },
            set: function (prop, layerId, value)
            {
                if (!layers.prop(layerId, 'hasLayerMask'))
                    throw new Error('Unable to set layer mask Linked: layer does not have a layer mask applied.');

                var desc = new ActionDescriptor();
                var ref = layers.ref(layerId);
                desc.putReference( c2id('null'), ref );
                    var descToggle = new ActionDescriptor();
                    descToggle.putBoolean( c2id('Usrs'), value );
                desc.putObject( c2id('T   '), c2id('Lyr '), descToggle );
                executeAction( c2id('setd'), desc, DialogModes.NO );}
            },

        'layerMaskDensity': {
            typeId: s2id('userMaskDensity'),
            type: DescValueType.UNITDOUBLE,
            defaultValue: 100.0,
            get: function (prop, layerId, desc)
            {
                if (!layers.prop(layerId, 'hasLayerMask'))
                    throw new Error('Unable to get layer mask density: layer does not have a layer mask applied.');

                return _byteToPercent(desc.getInteger(prop.typeId));
            },
            set: function (prop, layerId, value)
            {
                if (!layers.prop(layerId, 'hasLayerMask'))
                    throw new Error('Unable to set layer mask density: layer does not have a layer mask applied.');

                var ref = new ActionReference();
                _getLayerIdRef(layerId, ref);
                var desc = new ActionDescriptor();
                desc.putReference(c2id('null'), ref);
                var desc2 = new ActionDescriptor();
                desc2.putUnitDouble(prop.typeId, c2id('#Prc'), value);
                desc.putObject(c2id('T   '), c2id('Lyr '), desc2);
                executeAction(c2id('setd'), desc, _dialogModesNo);
            },
        },

        'layerMaskFeather': {
            typeId: s2id('userMaskFeather'),
            type: DescValueType.UNITDOUBLE,
            defaultValue: new UnitValue(0.0, 'px'),
            get: function (prop, layerId, desc)
            {
                if (!layers.prop(layerId, 'hasLayerMask'))
                    throw new Error('Unable to get layer mask feather: layer does not have a layer mask applied.');

                return desc.getUnitDoubleValue(prop.typeId);
            },
            set: function (prop, layerId, value)
            {
                if (!layers.prop(layerId, 'hasLayerMask'))
                    throw new Error('Unable to set layer mask feather: layer does not have a layer mask applied.');

                var ref = new ActionReference();
                _getLayerIdRef(layerId, ref);
                var desc = new ActionDescriptor();
                desc.putReference(c2id('null'), ref);
                var desc2 = new ActionDescriptor();
                desc2.putUnitDouble(prop.typeId, c2id('#Pxl'), value);
                desc.putObject(c2id('T   '), c2id('Lyr '), desc2);
                executeAction(c2id('setd'), desc, _dialogModesNo);
            },
        },

        'hasVectorMask': { typeId: s2id('hasVectorMask'), type: DescValueType.BOOLEANTYPE, set: false, },

        'vectorMaskEnabled': {
            typeId: s2id('vectorMaskEnabled'),
            type: DescValueType.BOOLEANTYPE,
            defaultValue: true,
            get: function (prop, layerId, desc)
            {
                if (!layers.prop(layerId, 'hasVectorMask'))
                    throw new Error('Unable to get layer mask enabled: layer does not have a layer mask applied.');

                return desc.getBoolean(prop.typeId);
            },
            set: function (prop, layerId, value)
            {
                if (!layers.prop(layerId, 'hasVectorMask'))
                    throw new Error('Unable to set layer mask enabled: layer does not have a vector mask applied.');

                var desc = new ActionDescriptor();
                var ref = layers.ref(layerId);
                desc.putReference( c2id('null'), ref );
                    var descToggle = new ActionDescriptor();
                    descToggle.putBoolean( s2id( "vectorMaskEnabled" ), value );
                desc.putObject( c2id('T   '), c2id('Lyr '), descToggle );
                executeAction( c2id('setd'), desc, DialogModes.NO );}
            },

        'vectorMaskLinked': {
            typeId: s2id('vectorMaskLinked'),
            type: DescValueType.BOOLEANTYPE,
            defaultValue: true,
            get: function (prop, layerId, desc)
            {
                throw new Error('Layer property "vectorMaskLinked" can only be set, never read. It simply does not exist.');
            },
            set: function (prop, layerId, value)
            {
                if (!layers.prop(layerId, 'hasVectorMask'))
                    throw new Error('Unable to set layer mask Linked: layer does not have a vector mask applied.');

                var desc = new ActionDescriptor();
                var ref = layers.ref(layerId);
                desc.putReference( c2id('null'), ref );
                    var descToggle = new ActionDescriptor();
                    descToggle.putBoolean( s2id( "vectorMaskLinked" ), value );
                desc.putObject( c2id('T   '), c2id('Lyr '), descToggle );
                executeAction( c2id('setd'), desc, DialogModes.NO );}
            },

        'vectorMaskDensity': {
            typeId: s2id('vectorMaskDensity'),
            type: DescValueType.UNITDOUBLE,
            defaultValue: 100.0,
            get: function (prop, layerId, desc)
            {
                if (!layers.prop(layerId, 'hasVectorMask'))
                    throw new Error('Unable to get vector mask density: layer does not have a vector mask applied.');

                return _byteToPercent(desc.getInteger(prop.typeId));
            },
            set: function (prop, layerId, value)
            {
                if (!layers.prop(layerId, 'hasVectorMask'))
                    throw new Error('Unable to set vector mask density: layer does not have a vector mask applied.');

                var ref = new ActionReference();
                _getLayerIdRef(layerId, ref);
                var desc = new ActionDescriptor();
                desc.putReference(c2id('null'), ref);
                var desc2 = new ActionDescriptor();
                desc2.putUnitDouble(prop.typeId, c2id('#Prc'), value);
                desc.putObject(c2id('T   '), c2id('Lyr '), desc2);
                executeAction(c2id('setd'), desc, _dialogModesNo);
            },
        },

        'vectorMaskFeather': {
            typeId: s2id('vectorMaskFeather'),
            type: DescValueType.UNITDOUBLE,
            defaultValue: new UnitValue(0.0, 'px'),
            get: function (prop, layerId, desc)
            {
                if (!layers.prop(layerId, 'hasVectorMask'))
                    throw new Error('Unable to get vector mask feather: layer does not have a vector mask applied.');

                return desc.getUnitDoubleValue(prop.typeId);
            },
            set: function (prop, layerId, value)
            {
                if (!layers.prop(layerId, 'hasVectorMask'))
                    throw new Error('Unable to set vector mask feather: layer does not have a vector mask applied.');

                var ref = new ActionReference();
                _getLayerIdRef(layerId, ref);
                var desc = new ActionDescriptor();
                desc.putReference(c2id('null'), ref);
                var desc2 = new ActionDescriptor();
                desc2.putUnitDouble(prop.typeId, c2id('#Pxl'), value);
                desc.putObject(c2id('T   '), c2id('Lyr '), desc2);
                executeAction(c2id('setd'), desc, _dialogModesNo);
            },
        },

        'hasFilterMask': { typeId: s2id('hasFilterMask'), type: DescValueType.BOOLEANTYPE, set: false, },

        'filterMaskDensity': {
            typeId: s2id('filterMaskDensity'),
            type: DescValueType.UNITDOUBLE,
            defaultValue: 100.0,
            get: function (prop, layerId, desc)
            {
                if (!layers.prop(layerId, 'hasFilterMask'))
                    throw new Error('Unable to get filter mask density: layer does not have a filter mask applied.');

                return _byteToPercent(desc.getInteger(prop.typeId));
            },
            set: function (prop, layerId, value)
            {
                if (!layers.prop(layerId, 'hasFilterMask'))
                    throw new Error('Unable to set filter mask density: layer does not have a filter mask applied.');

                var ref = new ActionReference();
                _getLayerIdRef(layerId, ref);
                var desc = new ActionDescriptor();
                desc.putReference(c2id('null'), ref);
                var desc2 = new ActionDescriptor();
                desc2.putUnitDouble(prop.typeId, c2id('#Prc'), value);
                desc.putObject(c2id('T   '), c2id('Lyr '), desc2);
                executeAction(c2id('setd'), desc, _dialogModesNo);
            },
        },

        'filterMaskFeather': {
            typeId: s2id('filterMaskFeather'),
            type: DescValueType.UNITDOUBLE,
            defaultValue: new UnitValue(0.0, 'px'),
            get: function (prop, layerId, desc)
            {
                if (!layers.prop(layerId, 'hasFilterMask'))
                    throw new Error('Unable to get filter mask feather: layer does not have a layer mask applied.');

                return desc.getUnitDoubleValue(prop.typeId);
            },
            set: function (prop, layerId, value)
            {
                if (!layers.prop(layerId, 'hasFilterMask'))
                    throw new Error('Unable to set filter mask feather: layer does not have a filter mask applied.');

                var ref = new ActionReference();
                _getLayerIdRef(layerId, ref);
                var desc = new ActionDescriptor();
                desc.putReference(c2id('null'), ref);
                var desc2 = new ActionDescriptor();
                desc2.putUnitDouble(prop.typeId, c2id('#Pxl'), value);
                desc.putObject(c2id('T   '), c2id('Lyr '), desc2);
                executeAction(c2id('setd'), desc, _dialogModesNo);
            },
        },

        'allLocked': {
            typeId: s2id('layerLocking'),
            type: DescValueType.BOOLEANTYPE,
            defaultValue: false,
            get: function (prop, layerId, desc)
            {
                return desc.getObjectValue(prop.typeId).getBoolean(s2id('protectAll'));
            },
            set: function (prop, layerId, value)
            {
                if (layers.prop(layerId, 'isBackgroundLayer'))
                {
                    if (value)
                    {
                        // We tried to lock the background layer, throw error
                        throw new Error('Unable to set lock on background layer.');
                    }
                    else
                    {
                        // We tried to unlock the background layer, let's make it a normal layer (this changes active layer)
                        _wrapSwitchActive(layerId, layers.makeLayerFromBackground);
                    }
                }
                else
                {
                    // Target layer must be active to change its lock
                    _wrapSwitchActive(layerId, function ()
                    {
                        var ref = new ActionReference();
                        _getLayerIdRef(layerId, ref);
                        var desc = new ActionDescriptor();
                        desc.putReference(c2id('null'), ref);

                        // Set lock object
                        var lock = new ActionDescriptor();
                        lock.putBoolean(s2id('protectAll'), value);

                        var desc2 = new ActionDescriptor();
                        desc2.putObject(prop.typeId, prop.typeId, lock);
                        desc.putObject(c2id('T   '), c2id('Lyr '), desc2);
                        executeAction(c2id('setd'), desc, _dialogModesNo);
                    });
                }
            },
        },

        'pixelsLocked': {
            typeId: s2id('layerLocking'),
            type: DescValueType.BOOLEANTYPE,
            defaultValue: false,
            get: function (prop, layerId, desc)
            {
                return desc.getObjectValue(prop.typeId).getBoolean(s2id('protectComposite'));
            },
            set: function (prop, layerId, value)
            {
                if (layers.prop(layerId, 'isBackgroundLayer'))
                    throw new Error('Unable to set pixels lock on background layer.');

                if (layers.prop(layerId, 'type') !== LayerType.CONTENT)
                    throw new Error('Pixels lock can not be set on layer sets.');

                var ref = new ActionReference();
                _getLayerIdRef(layerId, ref);
                var desc = new ActionDescriptor();
                desc.putReference(c2id('null'), ref);

                // Set lock object
                var lock = new ActionDescriptor();
                lock.putBoolean(s2id('protectComposite'), value);

                var desc2 = new ActionDescriptor();
                desc2.putObject(prop.typeId, prop.typeId, lock);
                desc.putObject(c2id('T   '), c2id('Lyr '), desc2);
                executeAction(c2id('setd'), desc, _dialogModesNo);
            },
        },

        'positionLocked': {
            typeId: s2id('layerLocking'),
            type: DescValueType.BOOLEANTYPE,
            defaultValue: false,
            get: function (prop, layerId, desc)
            {
                return desc.getObjectValue(prop.typeId).getBoolean(s2id('protectPosition'));
            },
            set: function (prop, layerId, value)
            {
                if (layers.prop(layerId, 'isBackgroundLayer'))
                    throw new Error('Unable to set position lock on background layer.');

                if (layers.prop(layerId, 'type') !== LayerType.CONTENT)
                    throw new Error('Position lock can not be set on layer sets.');

                var ref = new ActionReference();
                _getLayerIdRef(layerId, ref);
                var desc = new ActionDescriptor();
                desc.putReference(c2id('null'), ref);

                // Set lock object
                var lock = new ActionDescriptor();
                lock.putBoolean(s2id('protectPosition'), value);

                var desc2 = new ActionDescriptor();
                desc2.putObject(prop.typeId, prop.typeId, lock);
                desc.putObject(c2id('T   '), c2id('Lyr '), desc2);
                executeAction(c2id('setd'), desc, _dialogModesNo);
            },
        },

        'transparentPixelsLocked': {
            typeId: s2id('layerLocking'),
            type: DescValueType.BOOLEANTYPE,
            defaultValue: false,
            get: function (prop, layerId, desc)
            {
                return desc.getObjectValue(prop.typeId).getBoolean(s2id('protectTransparency'));
            },
            set: function (prop, layerId, value)
            {
                if (layers.prop(layerId, 'isBackgroundLayer'))
                    throw new Error('Unable to set transparency lock on background layer.');

                if (layers.prop(layerId, 'type') !== LayerType.CONTENT)
                    throw new Error('Transparency lock can not be set on layer sets.');

                var ref = new ActionReference();
                _getLayerIdRef(layerId, ref);
                var desc = new ActionDescriptor();
                desc.putReference(c2id('null'), ref);

                // Set lock object
                var lock = new ActionDescriptor();
                lock.putBoolean(s2id('protectTransparency'), value);

                var desc2 = new ActionDescriptor();
                desc2.putObject(prop.typeId, prop.typeId, lock);
                desc.putObject(c2id('T   '), c2id('Lyr '), desc2);
                executeAction(c2id('setd'), desc, _dialogModesNo);
            },
        },

        'isBackgroundLayer': {
            typeId: c2id('Bckg'),
            type: DescValueType.BOOLEANTYPE,
            get: function (prop, layerId, desc)
            {
                return layerId === 0 || desc.getBoolean(prop.typeId);
            },
            set: false,
        },

        'xmpMetadata': { typeId: s2id('metadata'), type: DescValueType.OBJECTTYPE, set: false, },

        'lastModified': {
            typeId: s2id('metadata'), // lastModified is a child of xmpMetadata
            type: DescValueType.DOUBLETYPE,
            get: function (prop, layerId, desc)
            {
                var lastModified = new Date();
                lastModified.setTime(desc.getObjectValue(prop.typeId).getDouble(s2id('layerTime')) * 1000.0); // Time is stored in seconds
                return lastModified;
            },
            set: false,
        },

        'smartObject': {
            typeId: s2id('smartObject'),
            type: DescValueType.OBJECTTYPE,
            get: function (prop, layerId, desc)
            {
                if (desc.hasKey(prop.typeId))
                    return desc.getObjectValue(prop.typeId);
            },
            set: false,
        },

        'smartObjectMore': {
            typeId: s2id('smartObjectMore'),
            type: DescValueType.OBJECTTYPE,
            get: function (prop, layerId, desc)
            {
                if (desc.hasKey(prop.typeId))
                    return desc.getObjectValue(prop.typeId);
            },
            set: false,
        },

        'smartObject.link': {
            typeId: s2id('smartObject'),
            type: DescValueType.ALIASTYPE,
            get: function (prop, layerId, desc)
            {
                if (!desc.hasKey(prop.typeId))
                        return;

                // Linked == ALIASTYPE, cloud == OBJECTTYPE
                var soDesc = layers.prop(layerId, 'smartObject');
                if( soDesc && soDesc.hasKey(s2id('link')) && soDesc.getType(s2id('link')) == prop.type)
                    return String(soDesc.getPath(s2id('link')));
            },
            set: function (prop, layerId, value)
            {
                try{
                    var desc = new ActionDescriptor();
                    desc.putPath( c2id( "null" ), _ensureFile( value ) );
                    executeAction( s2id( "placedLayerRelinkToFile"), desc, DialogModes.NO );
                } catch (e) {
                    throw new Error('Can not relink smart object...'+e.message);
                }
            },
        },

        'smartObject.compsList': {
            typeId: s2id('smartObject'),
            type: DescValueType.OBJECTTYPE,
            get: function (prop, layerId, desc)
            {
                if (desc.hasKey(prop.typeId))
                {
                    var compsDesc = layers.prop(layerId, 'smartObject').getObjectValue(s2id('compsList'));
                    if(compsDesc && compsDesc.hasKey(s2id('compList')))
                    {
                        var compList = compsDesc.getList(s2id('compList'));
                        var compObj = {};

                        //Reverse order so our layers stack properly
                        for (var c = compList.count-1; c >= 0; c--) {
                            var compObjDesc = compList.getObjectValue(c);
                            var compObjID = compObjDesc.getInteger(s2id('ID'));
                            compObj[compObjID] = compObjDesc.getString(s2id('name'));
                        }
                        return compObj;
                    }
                }

            },
            set: false,
        },

        'smartObjectMore.comp': {
            typeId: s2id('smartObjectMore'),
            type: DescValueType.INTEGERTYPE,
            get: function (prop, layerId, desc)
            {
                if (desc.hasKey(prop.typeId))
                    return layers.prop(layerId, 'smartObjectMore').getInteger(s2id('comp'));
            },
            set: function (prop, layerId, value)
            {
                try {
                    value = (typeof value === "number" && value>=0 )? value:-1;
                    var ref = layers.ref(layerId);

                    if ( executeActionGet(ref).hasKey(prop.typeId) )
                    {
                        var desc = new ActionDescriptor();
                        desc.putReference(c2id('null'), ref);
                        desc.putInteger( s2id( "compID"), value );
                        executeAction( s2id( "setPlacedLayerComp" ), desc, DialogModes.NO );
                    }
                } catch(e) {
                    throw new Error('Can not set comp on smart object...'+e.message);
                }
            },
        },

        'smartObjectMore.resolution': {
            typeId: s2id('smartObjectMore'),
            type: DescValueType.UNITDOUBLE,
            get: function (prop, layerId, desc)
            {
                if (desc.hasKey(prop.typeId))
                    return layers.prop(layerId, 'smartObjectMore').getDouble(s2id('resolution'));
            },
            set: false,
        },
    };

    /**
     * Gets the number of layers contained in the currently active document.
     * Please note: layer count will be zero if *only* the background layer is present in the document.
     * @return Layer count of the currently active document.
     */
    layers.count = function ()
    {
        if (_cache.hasOwnProperty('layerCount'))
            return _cache['layerCount'];

        // Get base count
        var ref = new ActionReference();
        ref.putProperty(c2id('Prpr'), c2id('NmbL'));
        ref.putEnumerated(c2id('Dcmn'), c2id('Ordn'), c2id('Trgt'));
        var count = executeActionGet(ref).getInteger(c2id('NmbL'));

        // If document has background, add 1 to layer count
        if (count > 0)
        {
            if (_cache.hasOwnProperty('hasBackground'))
            {
                if (_cache['hasBackground'])
                    count++;
            }
            else
            {
                ref = new ActionReference();
                ref.putProperty(c2id('Prpr'), c2id('Bckg'));
                ref.putEnumerated(c2id('Lyr '), c2id('Ordn'), c2id('Back'));
                if (executeActionGet(ref).getBoolean(c2id('Bckg')))
                    count++;
            }
        }

        return count;
    };

    /**
     * Gets the LayerId of the layer identified by the passed ItemIndex.
     * @return {Number} LayerId of the specified layer.
     */
    layers.getLayerIdByItemIndex = function (itemIndex)
    {
        var ref = new ActionReference();
        ref.putProperty(c2id('Prpr'), c2id('LyrI'));
        _getItemIndexRef(itemIndex, ref);
        return executeActionGet(ref).getInteger(c2id('LyrI'));
    };

    /**
     * Gets whether a background layer currently exists.
     * @return {Boolean} True if a background layer is currently existing; otherwise, false.
     */
    layers.hasBackground = function ()
    {
        if (_cache.hasOwnProperty('hasBackground'))
            return _cache['hasBackground'];

        if (Lifter.layers.count() === 0)
        {
            // Layer count will be zero if *only* the background layer is
            // present in document
            return true;
        }
        else
        {
            var ref = new ActionReference();
            ref.putProperty( c2id("Prpr"), s2id( "hasBackgroundLayer" ));
            ref.putEnumerated(c2id( "Dcmn" ),c2id( "Ordn" ),c2id( "Trgt" ));
            var desc =  executeActionGet(ref);
            var res = desc.getBoolean(s2id( "hasBackgroundLayer" ));
            return res;
        }
    };

    /**
     * Adds a new layer to the currently active document.
     * @param {String} [name] Layer name. Pass null for default value.
     * @param {String} [opacity] Layer opacity. Pass null for default value.
     * @param {BlendMode, LifterBlendMode} blendMode Layer blend mode. Pass null for default value.
     * @param {LayerColor} color Layer color. Pass null for default value.
     * @return Chained reference to layer utilities.
     */
    layers.add = function (name, opacity, blendMode, color)
    {
        var ref = new ActionReference();
        ref.putClass(c2id('Lyr '));
        var desc = new ActionDescriptor();
        desc.putReference(c2id('null'), ref);
        desc.putObject(c2id('Usng'), c2id('Lyr '), _getMakeLayerDescriptor(name, opacity, blendMode, color));
        executeAction(c2id('Mk  '), desc, _dialogModesNo);
        return layers;
    };

    /**
     * Adds a new layer set to the currently active document.
     * @param {String} [name] Layer set name. Pass null for default value.
     * @param {String} [opacity] Layer set opacity. Pass null for default value.
     * @param {BlendMode, LifterBlendMode} blendMode Layer set blend mode. Pass null for default value.
     * @param {LayerColor} color Layer set color. Pass null for default value.
     * @return Chained reference to layer utilities.
     */
    layers.addLayerSet = function (name, opacity, blendMode, color)
    {
        var ref = new ActionReference();
        ref.putClass(s2id('layerSection'));
        var desc = new ActionDescriptor();
        desc.putReference(c2id('null'), ref);
        desc.putObject(c2id('Usng'), s2id('layerSection'), _getMakeLayerDescriptor(name, opacity, blendMode, color));
        executeAction(c2id('Mk  '), desc, _dialogModesNo);
        return layers;
    };

    /**
     * Removes the specified layer from the currently active document.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return Chained reference to layer utilities.
     */
    layers.remove = function (layerId)
    {
        var ref = new ActionReference();
        _getLayerIdRef(layerId, ref);
        var desc = new ActionDescriptor();
        desc.putReference(c2id('null'), ref);
        executeAction(c2id('Dlt '), desc, _dialogModesNo);

        // Chaining
        return layers;
    };

    /**
     * Transforms the background of the current document in a normal layer.
     * @param {String} [name] Layer set name. Pass null for default value.
     * @param {String} [opacity] Layer set opacity. Pass null for default value.
     * @param {BlendMode, LifterBlendMode} blendMode Layer set blend mode. Pass null for default value.
     * @param {LayerColor} color Layer set color. Pass null for default value.
     * @return Chained reference to layer utilities.
     */
    layers.makeLayerFromBackground = function (name, opacity, blendMode, color)
    {
        // Do nothing if we do not have a background
        if (!Lifter.layers.hasBackground())
            return;

        var ref = new ActionReference();
        ref.putProperty(c2id('Lyr '), c2id('Bckg'));
        var desc = new ActionDescriptor();
        desc.putReference(c2id('null'), ref);
        desc.putObject(c2id('T   '), c2id('Lyr '), _getMakeLayerDescriptor(name, opacity, blendMode, color));
        executeAction(c2id('setd'), desc, _dialogModesNo);

        // Chaining
        return layers;
    };

    /**
     * Duplicates the specified layer into the specified document.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @param {Number} [documentId] Identifier of the document to copy the specified layer into. Defaults
     *                              to current document if null or not specified.
     * @return Chained reference to layer utilities.
     */
    layers.duplicate = function (layerId, documentId)
    {
        var ref = new ActionReference();
        _getLayerIdRef(layerId, ref);

        var desc = new ActionDescriptor();
        desc.putReference(c2id('null'), ref);

        if (documentId)
        {
            var ref2 = new ActionReference();
            ref.putIdentifier(c2id('Dcmn'), documentId);
            desc.putReference(c2id('T   '), ref2);
        }

        desc.putInteger(c2id('Vrsn'), 5);
        executeAction(c2id('Dplc'), desc, _dialogModesNo);

        // Chaining
        return layers;
    };

    /**
     * Applies the specified layer into another one.
     * @param {Number} [sourceDocumentId] Source document identifier, defaults to currently active document if null.
     * @param {Number} [sourceLayerId] Source layer identifier, defaults to currently active layer if null.
     * @param {ApplyImageChannel} [sourceLayerId=ApplyImageChannel.RGB] Source channel identifier.
     * @param {Boolean} [invert=false] Whether to invert the applied image.
     * @param {BlendMode, LifterBlendMode} [blendMode=LifterBlendMode.NORMAL] Blend mode.
     * @param {Number} [opacity=100] Blend opacity.
     * @param {Boolean} [preserveTransparency=true] Whether to preserve the transparency of the applied image.
     * @return Chained reference to layer utilities.
     */
    layers.applyImage = function (sourceDocumentId, sourceLayerId, sourceChannel, invert, blendMode, opacity, preserveTransparency)
    {
        if (!Lifter.documents)
            throw new Error('Lifter.layers.applyImage requires the Lifter.documents library.');

        // Validate parameters
        // Source document
        if (typeof sourceDocumentId !== 'number')
            sourceDocumentId = Lifter.documents.getActiveDocumentId();

        // Source layer
        if (sourceLayerId !== 'merged' && typeof sourceLayerId !== 'number')
            sourceLayerId = layers.stack.getActiveLayerId();

        // Source channel
        if (sourceChannel)
        {
            if (!Enumeration.contains(ApplyImageChannel, sourceChannel))
                throw new TypeError('Invalid sourceChannel:' + sourceChannel);
        }
        else
        {
            sourceChannel = ApplyImageChannel.RGB;
        }

        // Invert
        typeof invert === 'boolean' || (invert = false);

        // Blend mode
        (blendMode && blendMode.valueOf) || (blendMode = LifterBlendMode.NORMAL);
        blendMode = _ensureLifterBlendMode(blendMode);

        // Opacity and transparency
        typeof opacity === 'number' || (opacity = 100.0);
        typeof preserveTransparency === 'boolean' || (preserveTransparency = true);

        // Apply image
        // Source
        var ref = new ActionReference();
        ref.putEnumerated(c2id('Chnl'), c2id('Chnl'), sourceChannel.valueOf());

        if (sourceLayerId === 'merged')
        {
            ref.putEnumerated(c2id('Lyr '), c2id('Ordn'), c2id('Mrgd'));
        }
        else
        {
            // Check source document for background layer
            var activeDocId = Lifter.documents.getActiveDocumentId();
            Lifter.documents.makeActive(sourceDocId);

            if (layers.prop('isBackgroundLayer'))
                ref.putProperty(c2id('Lyr '), c2id('Bckg'));
            else
                ref.putIdentifier(c2id('Lyr '), sourceLayerId);

            Lifter.documents.makeActive(activeDocId);
        }

        ref.putIdentifier(c2id('Dcmn'), sourceDocumentId);

        var desc2 = new ActionDescriptor();
        desc2.putReference(c2id('T   '), ref);
        desc2.putEnumerated(c2id('Clcl'), c2id('Clcn'), blendMode.valueOf());
        desc2.putUnitDouble(c2id('Opct'), c2id('#Prc'), opacity);
        desc2.putBoolean(c2id('PrsT'), preserveTransparency);
        desc2.putBoolean(c2id('Invr'), invert);

        var desc = new ActionDescriptor();
        desc.putObject(c2id('With'), c2id('Clcl'), desc2);

        executeAction(c2id('AppI'), desc, _dialogModesNo);
        return layers;
    };

    /**
     * Inverts the specified layer.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return Chained reference to layer utilities.
     */
    layers.invert = function (layerId)
    {
        if (typeof layerId === 'number')
            layers.stack.makeActive(layerId);

        executeAction(c2id('Invr'), undefined, _dialogModesNo);
        return layers;
    };

    /**
     * Applies the specified layer into another one.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null.
     * @param {SolidColor} [fillColor] Fill color, defaults to background color if null.
     * @param {BlendMode, LifterBlendMode} [blendMode=LifterBlendMode.NORMAL] Blend mode.
     * @param {Number} [opacity=100] Blend opacity.
     * @return Chained reference to layer utilities.
     */
    layers.fill = function (layerId, fillColor, blendMode, opacity)
    {
        if (typeof layerId === 'number')
            layers.stack.makeActive(layerId);

        // Color
        (fillColor) || (fillColor = app.backgroundColor);

        if (!(fillColor instanceof SolidColor))
            throw new Error('Fill color must be a valid SolidColor: ' + fillColor);

        // Blend mode
        (blendMode && blendMode.valueOf) || (blendMode = LifterBlendMode.NORMAL);
        blendMode = _ensureLifterBlendMode(blendMode);

        // Opacity
        typeof opacity === 'number' || (opacity = 100.0);

        // Apply fill
        var desc = new ActionDescriptor();
        desc.putEnumerated(c2id('Usng'), c2id('FlCn'), c2id('Clr '));

        var desc2 = new ActionDescriptor();
        desc2.putUnitDouble(c2id('H   '), c2id('#Ang'), fillColor.hsb.hue);
        desc2.putDouble(c2id('Strt'), fillColor.hsb.saturation);
        desc2.putDouble(c2id('Brgh'), fillColor.hsb.brightness);
        desc.putObject(c2id('Clr '), c2id('HSBC'), desc2);

        desc.putUnitDouble(c2id('Opct'), c2id('#Prc'), opacity);
        desc.putEnumerated(c2id('Md  '), c2id('BlnM'), blendMode.valueOf());

        executeAction(c2id('Fl  '), desc, _dialogModesNo);

        return layers;
    };

    /**
     * Iterates over all layers contained in the current document, executing the specified callback on each element.
     * Please note: this iterates over ALL layers, including '</Layer group>', etc. Adding or removing layers
     * while iterating is not supported.
     * @param {Function} callback       Callback function. It is bound to context and invoked with two arguments (itemIndex, layerId).
     *                                  If callback returns true, iteration is stopped.
     * @param {Object} [context=null]   Callback function context.
     * @param {Boolean} [reverse=false] Whether to iterate from the end of the layer collection.
     * @return Chained reference to layer utilities.
     */
    layers.forEach = function (callback, context, reverse)
    {
        if (typeof callback !== 'function')
            throw new Error('Callback must be a valid function.');

        var n, i;

        // Cleanup cache
        delete _cache['hasBackground'];
        delete _cache['layerCount'];
        // Cache some information to speed up the operation
        _cache['hasBackground'] = layers.hasBackground();
        _cache['layerCount'] = layers.count();

        if (reverse)
        {
            i = _cache['layerCount'] + 1;
            n = 0;

            while (--i > n)
            {
                if (callback.call(context, i, layers.getLayerIdByItemIndex(i)))
                    break;
            }
        }
        else
        {
            n = _cache['layerCount'] + 1;
            i = 0;

            while (++i < n)
            {
                if (callback.call(context, i, layers.getLayerIdByItemIndex(i)))
                    break;
            }
        }

        // Cleanup cache
        delete _cache['hasBackground'];
        delete _cache['layerCount'];

        // Chaining
        return layers;
    };

    /**
     * Iterates over active layers, executing the specified callback on each element.
     * Please note: Adding or removing layers
     * while iterating is not supported.
     * @param {Function} callback       Callback function. It is bound to context and invoked with two arguments (itemIndex, layerId).
     *                                  If callback returns true, iteration is stopped.
     * @param {Object} [context=null]   Callback function context.
     * @param {Boolean} [reverse=false] Whether to iterate from the end of the layer collection.
     * @return Chained reference to layer utilities.
     */
    layers.forEachSelected = layers.forEachActive = function (callback, context, reverse)
    {
        if (typeof callback !== 'function')
            throw new Error('Callback must be a valid function.');

        var n, i;
        var activeLayerIds = layers.stack.getActiveLayerIds();
        if (reverse)
        {
            i = activeLayerIds.length;
            n = 0;

            while (--i >= n)
            {
                if (callback.call(context, i, activeLayerIds[i]))
                    break;
            }
        }
        else
        {
            n = activeLayerIds.length;
            i = 0;

            while (i < n)
            {
                if (callback.call(context, i, activeLayerIds[i]))
                    break;
                i++;
            }
        }

        // Chaining
        return layers;
    };

    /**
     * Gets or sets the property with the given name on the specified layer. If invoked with no arguments
     * gets a wrapped ActionDescriptor containing all the properties of the specified layer.
     * @param {Number} [layerId] Layer identifier, defaults to currently active document if null or not specified.
     * @param {String} [name] Property name.
     * @param {Any} [value] Property value.
     * @return {Any, ActionDescriptor, Object}  Property value when getting a property, a wrapped ActionDescriptor when invoked with no arguments
     *                                          or a chained reference to document utilities when setting a property.
     */
    layers.prop = function ()
    {
        // Parse args
        var layerId, name, value, ref, desc;

        if (typeof arguments[0] === 'number' ||
            (!arguments[0] && arguments.length > 1))
        {
            layerId = arguments[0];
            name = arguments[1];
            value = arguments[2];
        }
        else
        {
            name = arguments[0];
            value = arguments[1];
        }

        if (typeof name === 'undefined')
        {
            // Get wrapped action descriptor
            ref = new ActionReference();
            _getLayerIdRef(layerId, ref);
            desc = executeActionGet(ref);
            return _getWrappedActionDescriptor(desc, layers.supportedProperties, layerId || desc.getInteger(c2id('LyrI')));
        }
        else
        {
            // If unsupported, try generic getter
            if (!layers.supportedProperties.hasOwnProperty(name))
            {
                if (typeof value === 'undefined')
                {
                    try{
                        return _getDescPropByName(layers.desc(layerId), name);
                    } catch (e) {
                        log.warn(['Invalid layer property: "', name, '".'].join(''));
                        return;
                    }
                } else {
                    throw new Error(['Setting property "', name, '" is not supported by Lifter.'].join(''));
                }
            }

            var prop = layers.supportedProperties[name];

            if (typeof value === 'undefined')
            {
                // Get
                // Get ActionDescriptor for specified layer
                ref = new ActionReference();

                if (prop.typeId)
                    ref.putProperty(c2id('Prpr'), prop.typeId);

                _getLayerIdRef(layerId, ref);

                try {
                    desc = executeActionGet(ref);
                } catch (e) {
                    throw new Error('Unable to find '+typeIDToStringID(prop.typeId)+': layers do not have that property or it is un-gettable.');
                }

                if (prop.get)
                {
                    // Use custom getter for this property
                    return prop.get.call(null, prop, layerId, desc);
                }
                else
                {
                    // Call getter for specific type
                    return _getDescriptorProperty(desc, prop.typeId, prop.type);
                }
            }
            else
            {
                // Set
                if (!prop.set)
                    throw new Error(['Property "', name, '" is read-only.'].join(''));

                if (layers.prop(layerId, 'type') === LayerType.SETEND)
                    throw new Error(['Setting properties on a layer of type ', LayerType.SETEND.toString(), ' is not supported.'].join(''));

                // Set value
                prop.set.call(null, prop, layerId, value);

                // Chaining
                return layers;
            }
        }
    };

    /**
     * Finds all the layers with names matching the string or RegExp.
     * @param {String, RegExp} Exact string or regular expression to search in name.
     * @return {Array} An array containing seach results.
     */
     layers.findAllByName = function ( search )
     {
         var regex = (typeof search === "string")?  new RegExp('^'+search+'$'):  new RegExp(search);

         var matchIDs = [];
         layers.forEach(function(itemIndex, layerId){
             if( layers.prop(layerId,"name").search( regex ) !== -1)
                 matchIDs.push(layerId);
         } );
         return matchIDs;
     };

    /**
     * Finds all the layers that match the specified patterns.
     * @param {Object, Function} patterns Either an hash object specifying search criteria or a custom search function.
     * @param {Object} [context] Context applied to search function.
     * @return {Array} An array containing find results.
     */
    layers.findAll = _find.bind(null, layers, 0);

    /**
     * Finds the first layer that matches the specified patterns.
     * @param {Object, Function} patterns Either an hash object specifying search criteria or a custom search function.
     * @param {Object} [context] Context applied to search function.
     * @return {Object} Matching object, or null if no match was found.
     */
    layers.findFirst = _find.bind(null, layers, 1);

    /**
     * Finds the last layer that matches the specified patterns.
     * @param {Object, Function} patterns Either an hash object specifying search criteria or a custom search function.
     * @param {Object} [context] Context applied to search function.
     * @return {Object} Matching object, or null if no match was found.
     */
    layers.findLast = _find.bind(null, layers, 2);

    /**
     * Gets a list of all parents of the active or specified layer (or topmost layer of active layers).
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return {Array} LayerId of the all layer's parent groups in ordered list.
     */
    layers.getParentGroupIds = function (layerId)
    {
        var parentIDs = [];
        var tgtId = (typeof layerId == "number" )? layerId:layers.prop("layerId");
        // log.log(tgtId);

        // run in reverse so we can go "top to bottom"
        layers.forEach( function (itemIndex, layerId) {

            //log.log(itemIndex + ", " +layers.prop(layerId, "name"));

            if( layers.prop(layerId, "type") == LayerType.SETSTART )
            {
                parentIDs.push(layers.prop(layerId,"name"));
            }
            else if( layers.prop(layerId, "type") == LayerType.SETEND )
            {
                parentIDs.pop();
            }
            else if( layerId == tgtId )
            {
                // log.log(parentIDs);
                return parentIDs;
            }
        },null,true);

        return parentIDs;
    };

    /**
     * Gets the identifier of all layers.
     * @return {Array} LayerId of the all layers.
     */
    layers.getAllLayerIds = function ()
    {
        var allIDs = [];
        layers.forEach(function(itemIndex, layerId){allIDs.push(layerId);} );
        return allIDs;
    };

    /**
     * Gets the identifier of all active layers.
     * @return {Array} LayerIds of the currently active layers.
     */
    layers.getAllActiveLayerIds = function ()
    {
        var activeLayerIds = [];
        // Filter selected layers
        var docRef = new ActionReference();
        docRef.putEnumerated( c2id("Dcmn"), c2id("Ordn"), c2id("Trgt") );
        var docDesc = executeActionGet(docRef);

        // Get target layer ids
        if( docDesc.hasKey(s2id('targetLayersIDs'))) {
            targetLayersIDsDesc = docDesc.getList( s2id('targetLayersIDs'));

            for(var ii = 0; ii < targetLayersIDsDesc.count; ii++) {
                activeLayerIds.push(Number(targetLayersIDsDesc.getReference( ii ).getIdentifier()));
            }
        }

        return activeLayerIds;
    };

    // Stack
    /**
     * Provides methods to navigate across the layers stack.
     */
    layers.stack = {};
    layers.stack.getActiveLayerIds = layers.getAllActiveLayerIds;// alias
    _stackCache = {};// default for active is -1, default general is 0

    /**
     * Saves a list of layer ids to a cached stack list.
     * @method
     * @param  {Number} cacheId  cacheId to save stack to
     * @param  {Array}  layerIds list of layer ids to save
     * @return {Object}          this layers object for chaining
     */
    layers.stack.saveIdList = function (cacheId, layerIds)
    {
        // default and sanitize
        if (typeof cacheId !== "number"){ cacheId = 0; }
        if (typeof layerIds !== "object"){ layerIds = layers.getAllLayerIds(); }
        _stackCache[cacheId] = [].concat(layerIds);
        return layers;
    };

    /**
     * Saves ids of active layers to a cached stack list.
     * @method
     * @param  {Number} cacheId cacheId to save stack to
     * @return {Object}         this layers object for chaining
     */
    layers.stack.saveActiveIds = function (cacheId)
    {
        // default and sanitize
        if (typeof cacheId !== "number"){ cacheId = 0; }
        layers.stack.saveIdList( cacheId, layers.getAllActiveLayerIds() );
        return layers;
    };

    /**
     * Retrieves layer ids from a cached stack list.
     * @method
     * @param  {Number} cacheId cacheId to retrieve
     * @return {Array}          list of layers ids from cached stack
     */
    layers.stack.getIdList = function (cacheId)
    {
        // default and sanitize
        if (typeof cacheId !== "number"){ cacheId = 0; }
        return _stackCache[cacheId];
    };

    /**
     * Activates and deletes a cached stack list.
     * @method
     * @param  {Number} cacheId cacheId to activate and remove
     * @return {Object}         this layers object for chaining
     */
    layers.stack.restoreIdList = function (cacheId)
    {
        // default and sanitize
        if (typeof cacheId !== "number"){ cacheId = 0; }
        layers.stack.makeActive( layers.stack.getIdList( cacheId ) );
        delete _stackCache[cacheId];
        return layers;
    };

    /**
     * Gets the identifier of the currently active layer.
     * @return {Number} LayerId of the currently active layer.
     */
    layers.stack.getActiveLayerId = function ()
    {
        return layers.prop('layerId');
    };

    /**
     * Gets the identifier of the front layer.
     * @return {Number} LayerId of the front layer.
     */
    layers.stack.getFrontLayerId = _getStackId.bind(null, c2id('Frnt'));

    /**
     * Gets the identifier of the bottom/background layer.
     * @return {Number} LayerId of the bottom layer.
     */
    layers.stack.getBottomLayerId = _getStackId.bind(null, c2id('Back'));

    /**
     * Gets the identifier of the layer following the currently active one.
     * @return {Number} LayerId of the next layer.
     */
    layers.stack.getNextLayerId = _getStackId.bind(null, c2id('Frwr'));

    /**
     * Gets the identifier of the layer preceding the currently active one.
     * @return {Number} LayerId of the previous layer.
     */
    layers.stack.getPreviousLayerId = _getStackId.bind(null, c2id('Bckw'));

    /**
     * Sets the currently active layer to the one identified by the passed LayerId.
     * @param {Number,Array} layerIdList Layer identifier or array of ids.
     * @param {Boolean} [makeVisible] Whether to make the layer RGB channels visible.
     * @param {Boolean} [add] Whether to add or replace active layer selection.
     * @return Chained reference to layer utilities.
     */
    layers.stack.makeActive = function (layerIdList, makeVisible, add)
    {
        // clear active if not adding
        if ( add !== true )
            layers.stack.makeNoneActive();

        //support single layer selection
        layerIdList = [].concat(layerIdList);

        for(i=0; i<layerIdList.length; i++) {
            layerId = layerIdList[i];
            if (typeof layerId !== 'number' || layerId < 1)
                throw new Error('Invalid layerId: ' + layerId);

            makeVisible === true || (makeVisible = false);

            var ref = new ActionReference();
            ref.putIdentifier(c2id('Lyr '), layerId);
            var desc = new ActionDescriptor();
            desc.putReference(c2id('null'), ref);
            desc.putBoolean(c2id('MkVs'), makeVisible);
            desc.putEnumerated( s2id( "selectionModifier" ), s2id( "selectionModifierType" ), s2id( "addToSelection" ) );

            executeAction(c2id('slct'), desc, _dialogModesNo);
        }
        return layers;
    };

    /**
     * Sets the currently active layer to the front layer.
     * @return Chained reference to layer utilities.
     */
    layers.stack.makeAllActive = function() {
        layers.stack.makeActive(layers.getAllLayerIds());
    };

    /**
     * Sets the currently active layer to the front layer.
     * @return Chained reference to layer utilities.
     */
    layers.stack.makeFrontActive = _traverseStack.bind(null, c2id('Frnt'));

    /**
     * Sets the currently active layer to the bottom/background layer.
     * @return Chained reference to layer utilities.
     */
    layers.stack.makeBottomActive = _traverseStack.bind(null, c2id('Back'));

    /**
     * Sets the currently active layer to the one following the currently active layer.
     * @return Chained reference to layer utilities.
     */
    layers.stack.makeNextActive = _traverseStack.bind(null, c2id('Frwr'));

    /**
     * Sets the currently active layer to the one preceding the currently active layer.
     * @return Chained reference to layer utilities.
     */
    layers.stack.makePreviousActive = _traverseStack.bind(null, c2id('Bckw'));

    /**
    * Clears active layers so none are active.
    * @return Chained reference to layer utilities.
    */
    layers.stack.makeNoneActive = function ()
    {
        var desc = new ActionDescriptor();
        var ref = new ActionReference();

        ref.putEnumerated( c2id( "Lyr " ), c2id( 'Ordn' ), s2id( "targetEnum" ) );
        desc.putReference( c2id( 'null' ), ref );
        executeAction( s2id( 'selectNoLayers' ), desc, _dialogModesNo );

        return layers;
    };


    // Groups
    /**
     * Provides methods to navigate across the layers stack.
     */
    layers.groups = {};

    /**
     * Test if layer is a group
     * @method
     * @param  {Number} layerId Id of the layer to flatten
     * @return {Boolean} Layer is a group or not.
     */
    layers.groups.isGroup = function(layerId) {
        return layers.prop(layerId, 'type') == LayerType.SETSTART;
    },
    layers.isGroup = layers.groups.isGroup,// convenience alias


    /**
     * Make a new group with option to add layers from selected or Id array
     * @method
     * @param  {String} name      Name for new group
     * @param  {Boolean} addLayers Add layers to group or not
     * @param  {Number,Array} layerIds  layer Id or Array of layer Ids
     * @return Chained reference to layer utilities.
     */
    layers.groups.make = function(name, addLayers, layerIds, color)
    {
        var idLyr = s2id( "layer" );
        var idOrdn = c2id( "Ordn" );
        var idTrgt = s2id( "targetEnum" );
        var idnull = c2id( "null" );
        var refLyr;

        var descMake = new ActionDescriptor();
        var refClass = new ActionReference();
        refClass.putClass( s2id( "layerSection" ) );
        descMake.putReference( idnull, refClass );

        if (typeof layerIds === "number"){
            layerIds = [layerIds];
        }

        if(addLayers)
        {
            if(Array.isArray(layerIds))
            {
                layers.stack.makeActive(layerIds);
            }
            refLyr = new ActionReference();
            refLyr.putEnumerated( idLyr, idOrdn, idTrgt );
            descMake.putReference( c2id( "From" ), refLyr );
        }

        executeAction( s2id( "make" ), descMake, DialogModes.NO );

        if(name !== undefined && name.length)
        {
           var descSet = new ActionDescriptor();
           refLyr = new ActionReference();
           refLyr.putEnumerated( idLyr, idOrdn, idTrgt );
           descSet.putReference( idnull, refLyr );
           var descName = new ActionDescriptor();
           descName.putString( s2id( "name" ), name );
           descSet.putObject( s2id( "to" ), idLyr, descName );
           executeAction( s2id( "set" ), descSet, DialogModes.NO );
        }
        return layers;
    },

    /**
     * Merge (flatten) a layer group
     * @method
     * @param  {Number} layerId Id of the layer to flatten
     * @return Chained reference to layer utilities.
     */
    layers.groups.merge = function(layerId) {
        layers.stack.makeActive(layerId);
        executeAction(c2id("Mrg2"), undefined, DialogModes.NO);
        return layers;
    },


    // Smart Objects
    /**
     * Provides methods to work with smart objects.
     */
    layers.smartObjects = {};

    function _ensureSmartObjectIsActive(layerId) {

        // Make sure target layer is active
        if (typeof layerId === 'number')
            layers.stack.makeActive(layerId);

        if(layers.prop('kind')!==LayerKind.SMARTOBJECT)
            throw new Error('Layer '+layers.prop(null, 'name')+' must be a smart object.');

    }

    /** TODO: coverage for these guys...if possible

        PSString._add("placedLayerConvertToEmbedded");
        PSString._add("placedLayerConvertToLinked");
        PSString._add("placedLayerMakeCopy");
        PSString._add("placedLayerEmbedAll");
        PSString._add("placedLayerExportContents");
        PSString._add("placedLayerRelinkToFile");
        PSString._add("placedLayerRelinkToLibraries");
        PSString._add("placedLayerReplaceContents");
        PSString._add("placedLayerReplaceMissing");
        PSString._add("placedLayerRevealInOS");
        PSString._add("placedLayerUpdateAllModified");
        PSString._add("placedLayerUpdateModified");

    */

    /**
     * Converts the specified layer(s) to a smart object and makes it active.
     * @param {Number,Array,null} layerId Layer identifier(s), defaults to currently active layer if null or not specified.
     * @param {Boolean} isLink If true, link instead of embedded smart object.
     * @param {String, File} imageFile Path or File to valid image.
     * @return Chained reference to layer utilities.
     */
    layers.smartObjects.make = function (layerId, isLink, imageFile)
    {
        _ensureSmartObjectIsActive(layerId);

        executeAction(s2id('newPlacedLayer'), undefined, _dialogModesNo);

        if(isLink)
            layers.smartObjects.convertToLinked(null, imageFile);

        return layers;
    };

    /**
     * Creates a "New Smart Object via Copy" for embedded or linked smart objects
     * @param {Number,null} layerId Layer identifier, defaults to currently active layer if null or not specified.
     * @param {String, File} imageFile Path or File to valid image.
     * @param {Boolean} [skipPrompt] If true, and no image file passed in, autocreate new file name.
     * @return Chained reference to layer utilities.
     */
    layers.smartObjects.makeCopy = function (layerId, imageFile, skipPrompt)
    {
        _ensureSmartObjectIsActive(layerId);

        var srcLinkPath =  layers.prop('smartObject.link');
        if( srcLinkPath ) {

            // get name info
            var srcFile = new File (srcLinkPath);
            var searchIdx = srcFile.name.lastIndexOf('.');

            var srcLinkExtension = srcFile.name.slice(searchIdx, srcFile.name.length);
            var srcLinkBaseName = srcFile.name.slice(0,searchIdx);

            // try to increment name if numbered
            var srcLinkNameNumber = srcLinkBaseName.match(/\d*$/)[0];//get numbers off end of basename
            if(srcLinkNameNumber.length)
            {
                srcLinkBaseName = srcLinkBaseName.substr(0,srcLinkBaseName.length-srcLinkNameNumber.length);
                srcLinkBaseName += Number( Number(srcLinkNameNumber) + 1 ).pad( srcLinkNameNumber.length );
            }
            else
            {
                srcLinkBaseName += '_02';
            }

            // New file name... assemble!
            var newLinkName = srcLinkBaseName+srcLinkExtension;

            // default ask for new file name with autofilled prompt
            if( !skipPrompt ) {
                newLinkName = prompt("Enter a name for the new file to be linked...", newLinkName, "New File Name");
                // sanity check and sanitize
                if( typeof newLinkName !== "string" ){return;}

                if( newLinkName.search(srcLinkExtension) === -1 )
                {
                    newLinkName += srcLinkExtension;
                }
            }

            newLinkFile = new File (srcFile.parent +"/"+ newLinkName);
            if( newLinkFile.absoluteURI === srcFile.absoluteURI)
            {
                alert ("But... that's the same file... "+newLinkName, "Nooooooo!");
                return;
            }

            // Existing file check and overwrite confirmation included in copy()
            newLinkFile = Lifter.system.files.copy(srcFile, newLinkFile);

            // Verify
            if( typeof newLinkFile === "undefined" ){return;}
            if( !newLinkFile.exists )
            {
                log.error('Error copying file. No file found at destination: '+newLinkFile.name);
                return;
            }

            var newFilePath = newLinkFile.absoluteURI;

            // // ask smart object for "more" info
            var soMoreDesc = layers.prop('smartObjectMore');

            var compAppliedID = soMoreDesc.getInteger(s2id('comp'));

            // get SmartObject's inner canvas size
            // var sizeKeyDesc = getPropByName(soMoreDesc,'Sz  ');
            var sizeKeyDesc = soMoreDesc.getObjectValue(c2id('Sz  '));
            var soWidthInner = sizeKeyDesc.getDouble(s2id('width'));
            var soHeightInner = sizeKeyDesc.getDouble(s2id('height'));

            //Get 'nonAffineTransform' for most accurate scale
            var soVertList = soMoreDesc.getList(s2id('nonAffineTransform'));
            var soX = soVertList.getDouble(0);
            var soY = soVertList.getDouble(1);
            var soWidthPlaced = soVertList.getDouble(2)-soVertList.getDouble(0);
            var soHeightPlaced = soVertList.getDouble(5)-soVertList.getDouble(1);

            var soDPIRatio = soMoreDesc.getDouble(s2id('resolution'))/app.activeDocument.resolution;
            var soScaleX = (soWidthPlaced/soWidthInner)*soDPIRatio;
            var soScaleY = (soHeightPlaced/soHeightInner)*soDPIRatio;
            // $.writeln(soX);
            // $.writeln(soY);
            // $.writeln(soScaleX);
            // $.writeln(soScaleY);
            layers.smartObjects.place(newLinkFile, true, soX, soY, soScaleX, soScaleY);


            layers.smartObjects.setComp(null, compAppliedID );
        } else {
            executeAction(s2id('placedLayerMakeCopy'), undefined, _dialogModesNo);
        }
        return layers;
    };

    /**
     * Opens smart object layer for editing.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return Chained reference to layer utilities.
     */
    layers.smartObjects.edit = function (layerId)
    {
        _ensureSmartObjectIsActive(layerId);
        var desc = new ActionDescriptor();
        executeAction(s2id('placedLayerEditContents'), desc, DialogModes.NO);

        // Extra flush...cause editing doesn't update active doc properly.
        var activeDocId = Lifter.documents.getActiveDocumentId();
        Lifter.documents.makeActive(activeDocId);

        // Cleanup cache
        delete _cache['hasBackground'];
        delete _cache['layerCount'];

        return layers;
    };

    /**
     * Place a smart object with for link instead
     * @param {String, File} imageFile Path or File to valid image.
     * @param {Boolean} [isLink] If true, link instead of embedded smart object.
     * @param {Number} [scaleX] Width scale to apply (as percentage SO's internal canvas size).
     * @param {Number} [scaleY] Height scale to apply (percentage SO's internal canvas size).
     * @return Chained reference to layer utilities.
     */
    layers.smartObjects.place = function (imageFile, isLink, posX, posY, scaleX, scaleY)
    {

        scaleX = (scaleX !== undefined)?scaleX:100;
        scaleY = (scaleY !== undefined)?scaleY:100;

        if( !imageFile ) {
            imageFile = File.openDialog();
            if(!imageFile)
                throw new ERROR('User aborted convert to linked object...');
        }

        try
        {
            // Place now, position and scale after.
            var descPlace = new ActionDescriptor();
            var idPrc = c2id( "#Prc" );
            descPlace.putPath( c2id( "null" ), _ensureFile(imageFile) );
            descPlace.putEnumerated( c2id( "FTcs" ), c2id( "QCSt" ), c2id( "Qcsa" ) );

            if(isLink)
                descPlace.putBoolean( c2id( "Lnkd" ), true );

            executeAction( c2id( "Plc " ), descPlace, DialogModes.NO );

            var newLinkedLayer = app.activeDocument.activeLayer;

            // ask smart object for "more" info
            var soMoreDesc = layers.prop('smartObjectMore');

            // get SmartObject's inner canvas size
            var sizeKeyDesc = soMoreDesc.getObjectValue(c2id('Sz  '));
            var soWidthInner = sizeKeyDesc.getDouble(s2id('width'));
            var soHeightInner = sizeKeyDesc.getDouble(s2id('height'));

            //Get 'nonAffineTransform' for most accurate scale
            var soVertList = soMoreDesc.getList(s2id('nonAffineTransform'));
            var soX = soVertList.getDouble(0);
            var soY = soVertList.getDouble(1);
            var soWidthPlaced = soVertList.getDouble(2)-soVertList.getDouble(0);
            var soHeightPlaced = soVertList.getDouble(5)-soVertList.getDouble(1);

            var tgtWidth = (scaleX/100)*soWidthInner;
            var tgtHeight = (scaleY/100)*soHeightInner;

            // Smart Object scaling is affected by SO internal DPI...
            var soDPIRatio = soMoreDesc.getDouble(s2id('resolution'))/app.activeDocument.resolution;

            var newScaleX = (tgtWidth/soWidthPlaced) / soDPIRatio;
            var newScaleY = (tgtHeight/soHeightPlaced) / soDPIRatio;

            newScaleX *= 100;
            newScaleY *= 100;

            if( typeof posX == "number" && typeof posY == "number" ) {
                newLinkedLayer.translate( -( soX - posX ) + " px", -( soY - posY ) + " px" );
            }

            newLinkedLayer.resize(newScaleX,newScaleY, AnchorPosition.TOPLEFT);
        }
        catch ( e )
        {
            throw new Error('Can not place new smart object...'+e.message);
        }

        return layers;
    };

    /**
     * Convert a smart object to smart link
     * @param {Number,Array,null} layerId Layer identifier(s), defaults to currently active layer if null or not specified.
     * @param {String, File} imageFile Path or File to valid image.
     * @return Chained reference to layer utilities.
     */
    layers.smartObjects.convertToLinked = function (layerId, imageFile)
    {

        // not already a single smart object? Let's do that first and come back...
        if( layers.prop('kind')!==LayerKind.SMARTOBJECT ) {
            layers.smartObjects.make(layerId, true, imageFile);
        } else {
            // should have a single smart object now

            if( !imageFile ) {
                imageFile = File.openDialog();
                if(!imageFile)
                    throw new ERROR('User aborted convert to linked object...');
            }

            try
            {
                var ref = new ActionReference();
                _getLayerIdRef(layerId, ref);

                var desc = new ActionDescriptor();

                desc.putReference( c2id( "null" ), ref );
                desc.putPath( c2id( "Usng" ), _ensureFile(imageFile) );
                executeAction( s2id( "placedLayerConvertToLinked" ), desc, DialogModes.NO );
            }
            catch ( e )
            {
                throw new Error('Can not convert to linked object...'+e.message);
            }
        }

        return layers;
    };

    /**
     * Sets the layer comp for a Smart Object instance.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @param {Number} [compID] The unique ID of the layer comp to set instance to.
     * @return Chained reference to layer utilities.
     */
    layers.smartObjects.setComp = function (layerId, compID)
    {
        var cacheId = new Date().getMilliseconds();
        layers.stack.saveActiveIds( cacheId );
        layers.prop(layerId, 'smartObjectMore.comp', compID);
        layers.stack.restoreIdList( cacheId );

        return layers;
    };

    // Masks
    /**
     * Provides methods to work with masks on layer and layer sets.
     */
    layers.masks = {};

    // convenience tests... mostly just aliases for layers.prop() calls.
    /**
     * Check for user or vector mask on the specified layer.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return {Boolean} True if user or vector mask present on layer.
     */
    layers.masks.hasMask = function (layerId)
    {
        // filter mask is not checked here. check separately.
        return (layers.prop(layerId, 'hasUserMask')||layers.prop(layerId, 'hasVectorMask'));
    };

    /**
     * Check for user (pixel) mask on the specified layer.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return {Boolean} True if user mask present on layer.
     */
    layers.masks.hasLayerMask = function (layerId)
    {
        // filter mask is not checked here. check separately.
        return layers.prop(layerId, 'hasUserMask');
    };

    /**
     * Check for vector mask on the specified layer.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return {Boolean} True if vector mask present on layer.
     */
    layers.masks.hasVectorMask = function (layerId)
    {
        // filter mask is not checked here. check separately.
        return layers.prop(layerId, 'hasVectorMask');
    };

    /**
     * Check for filter mask on the specified layer.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return {Boolean} True if filter mask present on layer.
     */
    layers.masks.hasFilterMask = function (layerId)
    {
        return layers.prop(layerId, 'hasFilterMask');
    };

    // add/remove masks

    /**
     * Adds a layer mask to the specified layer and makes it active.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return Chained reference to layer utilities.
     */
    layers.masks.addLayerMask = function (layerId)
    {

        // Abort if layer already has a layer mask
        if (layers.prop(layerId, 'hasLayerMask'))
            throw new Error('Unable to add layer mask: layer already has one.');

        // Make layer if we're targeting background
        if (layers.prop(layerId, 'isBackgroundLayer')) {

            layers.makeLayerFromBackground();
            layers.stack.makeBottomActive();
        }
        // Make sure target layer is active
        else if (typeof layerId === 'number') {
            layers.stack.makeActive(layerId);
        }

        var ref = new ActionReference();
        ref.putEnumerated(c2id('Chnl'), c2id('Chnl'), c2id('Msk '));

        var desc = new ActionDescriptor();
        desc.putClass(c2id('Nw  '), c2id('Chnl'));
        desc.putReference(c2id('At  '), ref);

        // selection.hasOwnProperty("bounds") returned true when no selection
        // but would throw errors if selection.bounds accessed
        try{
            tmpTest = app.activeDocument.selection.bounds.length;
            desc.putEnumerated(c2id('Usng'), c2id('UsrM'), c2id('RvlS'));
        }
        catch(err){
            desc.putEnumerated(c2id('Usng'), c2id('UsrM'), c2id('RvlA'));
        }

        executeAction(c2id('Mk  '), desc, _dialogModesNo);
        return layers;
    };

    /**
     * Adds a vector mask to the specified layer and makes it active.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return Chained reference to layer utilities.
     */
    layers.masks.addVectorMask = function (layerId)
    {
        // Abort if layer already has a vector mask
        if (layers.prop(layerId, 'hasVectorMask'))
            throw new Error('Unable to add vector mask: layer already has one.');

        // Make layer if we're targeting background
        if (layers.prop(layerId, 'isBackgroundLayer'))
            layers.makeLayerFromBackground();

        // Make sure target layer is active
        if (typeof layerId === 'number')
            layers.stack.makeActive(layerId);

        var ref = new ActionReference();
        ref.putClass(c2id('Path'));

        var desc = new ActionDescriptor();
        desc.putReference(c2id('null'), ref);

        var ref2 = new ActionReference();
        ref2.putEnumerated(c2id('Path'), c2id('Path'), s2id('vectorMask'));
        desc.putReference(c2id('At  '), ref2);
        desc.putEnumerated(c2id('Usng'), s2id('vectorMaskEnabled'), c2id('RvlA'));
        executeAction(c2id('Mk  '), desc, _dialogModesNo);
        return layers;
    };

    /**
     * Removes the layer mask from the specified layer, optionally applying it.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @param {Boolean} [apply] Whether to apply the mask to the layer.
     * @return Chained reference to layer utilities.
     */
    layers.masks.removeLayerMask = function ()
    {
        _overloadFunction_Number_Bool(arguments, undefined, false);

        // Parse args
        var layerId = arguments[0],
            apply = arguments[1];

        var ref = new ActionReference();
        ref.putEnumerated(c2id('Chnl'), c2id('Chnl'), c2id('Msk '));
        _getLayerIdRef(layerId, ref);

        var desc = new ActionDescriptor();
        desc.putReference(c2id('null'), ref);
        desc.putBoolean(c2id('Aply'), apply);
        executeAction(c2id('Dlt '), desc, _dialogModesNo);
        return layers;
    };

    /**
     * Removes the vector mask from the specified layer. "apply" will either apply
     * to the existing layer mask or directly to the layer if no layer mask found.
     *
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @param {Boolean} [apply] Whether to rasterize and apply the mask to the layer.
     * @return Chained reference to layer utilities.
     */
    layers.masks.removeVectorMask = function ()
    {
        _overloadFunction_Number_Bool(arguments, undefined, false);

        // Parse args
        var layerId = arguments[0],
            apply = arguments[1],
            desc = new ActionDescriptor();

        if( apply ) {
            // No way to directly apply vector mask, so rasterize first
            // if existing layer mask, it intersects into that
            var hasUserMask = layers.masks.hasLayerMask(layerId);
            var rasterizeLayerId = s2id('rasterizeLayer');

            // save layer selection and activate target layer
            layers.stack.saveActiveIds(rasterizeLayerId);
            layers.stack.makeActive(layerId);

    		desc.putReference( c2id( "null" ), layers.ref(layerId) );
    		desc.putEnumerated( c2id( "What" ), s2id( "rasterizeItem" ), s2id( "vectorMask" ) );
    		executeAction( rasterizeLayerId, desc, DialogModes.NO );

            // don't delete if layer mask was already present
            if( !hasUserMask ) {
                layers.masks.removeLayerMask(layerId,true);
            }

            // restore original selection
            layers.stack.restoreIdList(rasterizeLayerId);

        } else {
            var ref = new ActionReference();
            ref.putEnumerated(c2id('Path'), c2id('Path'), s2id('vectorMask'));
            _getLayerIdRef(layerId, ref);

            desc.putReference(c2id('null'), ref);
            executeAction(c2id('Dlt '), desc, _dialogModesNo);
        }

        return layers;
    };

    /**
     * Switch whether user mask of the specified layer is active or not so that drawing operations
     * can be performed on it.
     *
     * Overloaded for 0, 1, and 2 args eg. fn(), fn(id), fn(true), fn(id, true)
     *
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @param {Boolean} [active] Whether to make the layer mask active or not.
     * @return Chained reference to layer utilities.
     */
    layers.masks.makeLayerMaskActive = function ()
    {
        _overloadFunction_Number_Bool(arguments, undefined, true);

        // Parse args
        var layerId = arguments[0],
            active = arguments[1];

        // mask or RGB (layer pixels) channel?
        var channel = ( active )? 'Msk ': 'RGB ';

        var ref = new ActionReference(),
            desc = new ActionDescriptor();

        ref.putEnumerated(c2id('Chnl'), c2id('Chnl'), c2id(channel));
        _getLayerIdRef(layerId, ref);

        desc.putReference(c2id('null'), ref);
        executeAction(c2id('slct'), desc, _dialogModesNo);

        return layers;
    };

    /**
     * Switch whether vector mask of the specified layer is active or not so that drawing operations
     * can be performed on it.
     *
     * Overloaded for 0, 1, and 2 args eg. fn(), fn(id), fn(true), fn(id, true)
     *
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @param {Boolean} [active] Whether to make the vector mask active or inactive.
     * @return Chained reference to layer utilities.
     */
    layers.masks.makeVectorMaskActive = function ()
    {
        _overloadFunction_Number_Bool(arguments, undefined, true);

        // Parse args
        var layerId = arguments[0],
            active = arguments[1];

        // different commands for activate and deactivate...
        var ref = new ActionReference(),
            desc = new ActionDescriptor(),
            execId;

        if (active)
        {
            ref.putEnumerated(c2id('Path'), c2id('Path'), s2id('vectorMask'));
            _getLayerIdRef(layerId, ref);
            execId = c2id('slct');
        }
        else
        {
            ref.putClass(c2id('Path'));
            _getLayerIdRef(layerId, ref);
            execId = c2id('Dslc');
        }

        // execute!
        desc.putReference(c2id('null'), ref);
        executeAction(execId, desc, _dialogModesNo);

        return layers;
    };


    /**
    * Switch whether user mask of the specified layer is active or not
    *
    * Overloaded for 0, 1, and 2 args eg. fn(), fn(id), fn(true), fn(id, true)
    *
    * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
    * @param {Boolean} [makeVisible] Whether to make the layer mask visible.
    * @return Chained reference to layer utilities.
    */
    layers.masks.makeLayerMaskVisible = function ()
    {
        _overloadFunction_Number_Bool(arguments, undefined, true);

        // Parse args
        var layerId = arguments[0],
            visible = arguments[1];

        // different commands for activate and deactivate...
        var ref = new ActionReference(),
            desc = new ActionDescriptor();

        ref.putEnumerated(c2id('Chnl'), c2id('Chnl'), c2id('Msk '));
        _getLayerIdRef(layerId, ref);

        desc.putReference(c2id('null'), ref);
        desc.putBoolean(c2id('MkVs'), visible);
        executeAction(c2id('slct'), desc, _dialogModesNo);

        return layers;
    };


    /**
    * Switch whether the mask(s) of the specified layer are enabled or not
    *
    * Overloaded for 0, 1, and 2 args eg. fn(), fn(id), fn(true), fn(id, true)
    *
    * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
    * @param {Boolean} [enable] Whether to make the mask affect the layer.
    * @return Chained reference to layer utilities.
    */
    layers.masks.enable = function ()
    {
        // fake function overloading
        _overloadFunction_Number_Bool(arguments, undefined, true);

        // Parse args
        var layerId = arguments[0],
            enable = arguments[1];

        if(layers.masks.hasLayerMask(layerId)) {
            layers.masks.enableLayerMask(layerId, enable);
        }

        if(layers.masks.hasVectorMask(layerId)) {
            layers.masks.enableVectorMask(layerId, enable);
        }

        return layers;
    };


    /**
    * Switch whether user mask of the specified layer is enabled or not
    *
    * Overloaded for 0, 1, and 2 args eg. fn(), fn(id), fn(true), fn(id, true)
    *
    * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
    * @param {Boolean} [enable] Whether to make the mask affect the layer.
    * @return Chained reference to layer utilities.
    */
    layers.masks.enableLayerMask = function ()
    {
        // fake function overloading
        _overloadFunction_Number_Bool(arguments, undefined, true);

        // Parse args
        var layerId = arguments[0],
            enable = arguments[1];

        layers.prop(layerId,'layerMaskEnabled',enable);
        return layers;
    };


    /**
    * Switch whether user mask of the specified layer is enabled or not
    *
    * Overloaded for 0, 1, and 2 args eg. fn(), fn(id), fn(true), fn(id, true)
    *
    * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
    * @param {Boolean} [enable] Whether to make the mask affect the layer.
    * @return Chained reference to layer utilities.
    */
    layers.masks.enableVectorMask = function ()
    {
        // fake function overloading
        _overloadFunction_Number_Bool(arguments, undefined, true);

        // Parse args
        var layerId = arguments[0],
            enable = arguments[1];

        layers.prop(layerId,'vectorMaskEnabled', enable);

        return layers;
    };


    /**
     * Creates a selection from the layer mask of the specified layer.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return Chained reference to layer utilities.
     */
    layers.masks.selectLayerMask = function (layerId)
    {
        var ref = new ActionReference();
        ref.putProperty(c2id('Chnl'), c2id('fsel'));

        var ref2 = new ActionReference();
        ref2.putEnumerated(c2id('Chnl'), c2id('Chnl'), c2id('Msk '));
        _getLayerIdRef(layerId, ref);

        var desc = new ActionDescriptor();
        desc.putReference(c2id('null'), ref);
        desc.putReference(c2id('T   '), ref2);
        executeAction(c2id('setd'), desc, _dialogModesNo);

        return layers;
    };

    /**
     * Creates a selection from the vector mask of the specified layer.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return Chained reference to layer utilities.
     */
    layers.masks.selectVectorMask = function (layerId)
    {
        var ref = new ActionReference();
        ref.putProperty(c2id('Chnl'), c2id('fsel'));

        var ref2 = new ActionReference();
        ref2.putEnumerated(c2id('Path'), c2id('Path'), s2id('vectorMask'));
        _getLayerIdRef(layerId, ref2);

        var desc = new ActionDescriptor();
        desc.putReference(c2id('null'), ref);
        desc.putReference(c2id('T   '), ref2);

        desc.putInteger(c2id('Vrsn'), 1);
        desc.putBoolean(s2id('vectorMaskParams'), true);
        executeAction(c2id('setd'), desc, _dialogModesNo);

        return layers;
    };

    /**
     * Set mask linked state for both layer and vector masks.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return Chained reference to layer utilities.
     */
    layers.masks.setMaskLink = function ()
    {
        _overloadFunction_Number_Bool(arguments, undefined, true);

        // Parse args
        var layerId = arguments[0],
            setLink = arguments[1];

        if(layers.masks.hasLayerMask(layerId)) {
            layers.masks.setLayerMaskLink(layerId, setLink);
        }

        if(layers.masks.hasVectorMask(layerId)) {
            layers.masks.setVectorMaskLink(layerId, setLink);
        }

        return layers;
        // // different commands for activate and deactivate...
        // var ref = new ActionReference(),
        //     desc = new ActionDescriptor();

        // //default to true unless explicitly false
        // setLink = setLink !== false;
        //
        // if( layers.masks.hasMask() )
        // {
        //     try{
        //         var maskTypeID = (layers.masks.hasUserMask())? c2id('Usrs'):c2id( "vectorMaskLinked");
        //         var desc = new ActionDescriptor();
        //         var ref = layers.ref(layerId);
        //         desc.putReference( c2id('null'), ref );
        //             var descToggle = new ActionDescriptor();
        //             descToggle.putBoolean( maskTypeID, setLink );
        //         desc.putObject( c2id('T   '), c2id('Lyr '), descToggle );
        //         executeAction( c2id('setd'), desc, DialogModes.NO );}
        //     catch(e){
        //         e.message = "Failed to set mask link: " + e.message;
        //         log.error( e );
        //     }
        // }
    };


    /**
     * Set mask linked state for layer mask.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return Chained reference to layer utilities.
     */
    layers.masks.setLayerMaskLink = function ()
    {
        _overloadFunction_Number_Bool(arguments, undefined, true);

        if(layers.masks.hasLayerMask(arguments[0])) {
            layers.prop(arguments[0],'layerMaskLinked',arguments[1]);
        }
    };


    /**
     * Set mask linked state for vector mask
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return Chained reference to layer utilities.
     */
    layers.masks.setVectorMaskLink = function ()
    {
        _overloadFunction_Number_Bool(arguments, undefined, true);

        if(layers.masks.hasLayerMask(arguments[0])) {
            layers.prop(arguments[0],'vectorMaskLinked', arguments[1]);
        }

        return layers;
    };


    /**
     * Refines the layer mask of the specified layer.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null.
     * @return Chained reference to layer utilities.
     */
    layers.masks.refineLayerMask = function (layerId, edgeBorderRadius, edgeBorderContrast, edgeSmooth, edgeFeatherRadius, edgeChoke, edgeAutoRadius, edgeDecontaminate)
    {
        // Parse args
        typeof edgeBorderRadius === 'number' || (edgeBorderRadius = 0.0);
        typeof edgeBorderContrast === 'number' || (edgeBorderContrast = 0.0);
        typeof edgeSmooth === 'number' || (edgeSmooth = 0);
        typeof edgeFeatherRadius === 'number' || (edgeFeatherRadius = 0.0);
        typeof edgeChoke === 'number' || (edgeChoke = 0.0);
        typeof edgeAutoRadius === 'boolean' || (edgeAutoRadius = false);
        typeof edgeDecontaminate === 'boolean' || (edgeDecontaminate = false);

        var desc = new ActionDescriptor();
        desc.putReference( c2id( "null" ), layers.ref(layerId) );// super shortcut ref

        desc.putUnitDouble(s2id('refineEdgeBorderRadius'), c2id('#Pxl'), Math.abs(edgeBorderRadius));
        desc.putUnitDouble(s2id('refineEdgeBorderContrast'), idPrc, Math.abs(edgeBorderContrast));
        desc.putInteger(s2id('refineEdgeSmooth'), Math.abs(Math.ceil(edgeSmooth)));
        desc.putUnitDouble(s2id('refineEdgeFeatherRadius'), c2id('#Pxl'), Math.abs(edgeFeatherRadius));
        desc.putUnitDouble(s2id('refineEdgeChoke'), c2id('#Prc'), Math.abs(edgeChoke));
        desc.putBoolean(s2id('refineEdgeAutoRadius'), edgeAutoRadius);
        desc.putBoolean(s2id('refineEdgeDecontaminate'), edgeDecontaminate);
        desc.putEnumerated(s2id('refineEdgeOutput'), s2id('refineEdgeOutput'), s2id('refineEdgeOutputUserMask'));
        executeAction(s2id('refineSelectionEdge'), desc, _dialogModesNo);

        // Chaining
        return layers;
    };


    /**
     * Inverts the layer mask of the specified layer.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return Chained reference to layer utilities.
     */
    layers.masks.invertLayerMask = function (layerId)
    {
        layers.masks.makeLayerMaskVisible(layerId, true);
        executeAction( c2id('Invr'), undefined, DialogModes.NO );
        layers.masks.makeLayerMaskVisible(layerId, false);

        return layers;
    };


    // Direct manipulation

    /**
     * Merges or rasterizes a layer group or smart object.
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return Chained reference to layer utilities.
     */
    layers.rasterize = function (layerId)
    {
        var rasterizeLayerId = s2id('rasterizeLayer');

        layers.stack.saveActiveIds(rasterizeLayerId);
        layers.stack.makeActive(layerId);

        if( layers.isGroup(layerId) ) {
            layers.groups.merge(layerId);
        } else {
            var desc = new ActionDescriptor();
            desc.putReference(c2id('null'), layers.ref());
            executeAction(s2id('rasterizeLayer'), desc, _dialogModesNo);
        }

        layers.stack.restoreIdList(rasterizeLayerId);

        return layers;
    };

    /**
     * Locks or unlocks layers. Takes layer Id or uses active layers
     * @param {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @param {Boolean} [setLocked] lock or don't lock.
     * @return Chained reference to layer utilities.
     */
    layers.setLocked = function (layerId, setLocked)
    {
        setLocked = (setLocked !== false);//lock by default
        layers.prop(layerId, 'allLocked', setLocked);
        return layers;
    };

    /**
     * Toggles visibility isolation on a layer (can't specify on/off only toggle)
     * @method
     * @param  {Number} [layerId] Layer identifier, defaults to currently active layer if null or not specified.
     * @return Chained reference to layer utilities.
     */
    layers.toggleIsolate = function (layerId)
    {
        var ref = new ActionReference();
        _getLayerIdRef(layerId, ref);
        var list = new ActionList();
        list.putReference(ref);
        var desc = new ActionDescriptor();
        desc.putList(c2id('null'), list);
        desc.putBoolean( c2id('TglO'), true );

        executeAction(c2id('Shw '), desc, _dialogModesNo);
        return layers;
    },

    // Public API
    /**
     * Contains low-level methods to work with layers without accessing Photoshop DOM.
     *
     * Layers are identified by two numbers in Photoshop: LayerId and ItemIndex.
     *
     *  - LayerId: progressive 1-based unique integer identifier that does not change when the document is
     *             modified, open, saved or closed. When a layer is deleted, its LayerId won't be re-assigned
     *             to new layers. Background LayerId is a special case and it's always '0' if only the background
     *             layer is present in the document.
     *  - ItemIndex: a 1-based integer index that depends on layer position in hierarchy. It changes every
     *               time the layer is moved.
     *
     * The functions below use LayerId to get a valid reference to a layer. LayerIds are easier to work
     * with than ItemIndexes because are unique and does not changed based on whether a background
     * layer is present in the document (see below).
     *
     * Some brief notes about ItemIndexes: they behave differently when the background layer
     * is present in the document:
     *
     *  - with background: 'Background' = 1, 'Layer 1' = 2 ('Background' accessed with 0, 'Layer 1' accessed with 1)
     *  - without background: 'Layer 0' = 1, 'Layer 1' = 2 ('Layer 0' accessed with 1, 'Layer 1' accessed with 2)
     *
     * Also, when *only* the background layer is present in the document, getting a
     * reference to it via ItemIndex results in an error: it must be get using
     * Lyr -> Ordn -> Trgt enumeration value. No special actions are required when only one
     * non-background layer is present in the document. This is true for LayerIds too.
     */
    Lifter.layers = layers;
    log.log("Lifter.layers done...");
}());
