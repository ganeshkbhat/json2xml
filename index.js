/**
 * Node.js script for converting XML to JSON and JSON back to XML using
 * custom, library-free logic.
 *
 * NOTE: This custom implementation is highly simplified and designed to handle
 * well-formed XML structure. It is not as robust as a full XML parsing library.
 */

// --- Configuration Constants (Mirroring xml2js conventions) ---
const ATTR_KEY = "@";
const TEXT_KEY = "#text";
const COMMENT_KEY = "#comment";

// --- XML to JSON Conversion (Custom Parser) ---

/**
 * Converts a simplified XML string to a structured JSON object.
 *
 * @param {string} xml - The XML string to convert.
 * @returns {object} The resulting JSON object.
 */
function xmlToJson(xml) {
    // 1. Clean up XML string and remove XML declaration
    let cleanXml = xml.replace(/<\?xml[^>]*\?>/, '').trim();
    
    // 2. Wrap the root element in a container to simplify top-level processing
    cleanXml = `<_root>${cleanXml}</_root>`; 

    // Regex to capture start tags, end tags, or comments.
    const TAG_REGEX = /<(\/)?([a-zA-Z0-9:_-]+)([^>]*)>|<!--([\s\S]*?)-->/g;
    
    const root = {};
    const stack = [root]; // Stack stores the current element object being processed
    
    let match;
    let lastIndex = 0;

    const getCurrentElement = () => stack[stack.length - 1];

    /**
     * Extracts attributes from a tag string (e.g., ' id="p1" class="c2"')
     * @param {string} attrString - The raw attributes string.
     * @returns {object} An object of attributes prefixed with ATTR_KEY.
     */
    const parseAttributes = (attrString) => {
        const attrs = {};
        const attrRegex = /([a-zA-Z0-9:_-]+)\s*=\s*("|')([^"']*)\2/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrString)) !== null) {
            attrs[ATTR_KEY + attrMatch[1]] = attrMatch[3];
        }
        return attrs;
    };

    /**
     * Adds text content found between the last token and the current one.
     * @param {number} currentIndex - The start index of the current match.
     */
    const addTextContent = (currentIndex) => {
        const text = cleanXml.substring(lastIndex, currentIndex).trim();
        if (text) {
            const currentObj = getCurrentElement();
            // Text is added to the last child object in the array if it exists, 
            // otherwise, it's added to the parent's #text property.
            const parts = currentObj.parts || currentObj;
            
            // Check if the text needs to be part of a text node or mixed content
            if (Array.isArray(parts)) {
                parts.push({ [TEXT_KEY]: text });
            } else if (currentObj[TEXT_KEY]) {
                 currentObj[TEXT_KEY] += ' ' + text;
            } else {
                 currentObj[TEXT_KEY] = text;
            }
        }
    };


    while ((match = TAG_REGEX.exec(cleanXml)) !== null) {
        addTextContent(match.index);
        lastIndex = TAG_REGEX.lastIndex;
        
        const currentObj = getCurrentElement();

        // Check if it's a comment
        if (match[4] !== undefined) {
            // It's a comment: match[4] holds the comment content
            const comment = match[4].trim();
            if (!currentObj.parts) currentObj.parts = [];
            currentObj.parts.push({ [COMMENT_KEY]: comment });
            continue;
        }

        // It's a tag (start or end)
        const isClosingTag = match[1] === '/';
        const tagName = match[2];
        const attributesString = match[3];

        if (isClosingTag) {
            // End Tag: Pop the stack
            if (stack.length > 1) { // Never pop the root placeholder
                stack.pop();
            }
        } else {
            // Start Tag: Create new element and push to stack
            const newElement = {
                ...parseAttributes(attributesString),
                parts: [], // Use 'parts' array to preserve order of children, text, and comments
            };

            // Add the new element to the parent's object
            const parent = getCurrentElement();
            if (parent.parts) {
                // If parent has a 'parts' array (for mixed/ordered content)
                parent.parts.push({ [tagName]: newElement.parts, ...newElement });
                delete newElement.parts; // Clean up the object structure
            } else {
                // Simplified case: treat as property
                if (!parent[tagName]) {
                    parent[tagName] = newElement;
                } else if (Array.isArray(parent[tagName])) {
                    parent[tagName].push(newElement);
                } else {
                    parent[tagName] = [parent[tagName], newElement];
                }
            }
            
            // Push the new element onto the stack to start adding its children
            stack.push(newElement);
        }
    }
    
    // Clean up the temporary root container and return the actual root element
    if (root._root && root._root.parts && root._root.parts.length === 1) {
        const rootElement = root._root.parts[0];
        const rootTagName = Object.keys(rootElement).find(key => key !== ATTR_KEY);
        
        // Final structure: { "rootTagName": [{ ..., parts: [...] }] }
        return { 
            [rootTagName]: [ { 
                ...rootElement,
                [rootTagName]: rootElement.parts 
            } ]
        };
    }
    
    // Fallback for simple XML
    return root;
}


// --- JSON to XML Conversion (Custom Builder) ---

/**
 * Recursively builds the XML string from a structured JSON object.
 * @param {object} node - The JSON node to convert.
 * @param {string} tagName - The name of the current tag.
 * @returns {string} The resulting XML fragment.
 */
function buildNode(node, tagName) {
    if (!node) return '';

    // 1. Handle Comment Node
    if (node[COMMENT_KEY]) {
        return `<!--${node[COMMENT_KEY]}-->`;
    }

    // 2. Separate Attributes, Text, and Children
    const attributes = [];
    const childrenContent = [];
    let textContent = '';

    const keys = Object.keys(node);

    for (const key of keys) {
        const value = node[key];

        // a) Attributes (prefixed with ATTR_KEY)
        if (key.startsWith(ATTR_KEY)) {
            const attrName = key.substring(ATTR_KEY.length);
            attributes.push(`${attrName}="${value}"`);
            continue;
        }

        // b) Text Content (TEXT_KEY)
        if (key === TEXT_KEY) {
            textContent = value;
            continue;
        }

        // c) Children (Elements or Comments)
        if (Array.isArray(value)) {
            // Handle arrays of children (same tag name or mixed content)
            for (const item of value) {
                // Check if item is a direct comment object (for mixed content)
                if (item && item[COMMENT_KEY] !== undefined) {
                    childrenContent.push(buildNode(item));
                } 
                // Check if item is a text node (for mixed content)
                else if (item && item[TEXT_KEY] !== undefined) {
                    childrenContent.push(item[TEXT_KEY]);
                }
                // Check if it's an element (key is the tag name)
                else {
                    const childTagName = Object.keys(item).find(k => !k.startsWith(ATTR_KEY) && k !== TEXT_KEY);
                    if (childTagName) {
                        childrenContent.push(buildNode(item, childTagName));
                    }
                }
            }
        } else if (typeof value === 'object' && value !== null) {
            // Handle single child object (key is the tag name)
            childrenContent.push(buildNode(value, key));
        } else {
            // Handle string/number value as simple text content for the current tag
            textContent = value;
        }
    }

    // 3. Construct XML Tag
    const attrString = attributes.length > 0 ? ' ' + attributes.join(' ') : '';
    const innerContent = textContent + childrenContent.join('');
    
    // Check for self-closing tag or empty content
    if (!innerContent.trim() && !tagName) {
        // If no content and no tag name (e.g., empty array element), return empty
        return '';
    }

    if (!innerContent.trim()) {
        // Self-closing tag for empty content, preserving attributes
        return `<${tagName}${attrString}/>`;
    }

    // Standard opening and closing tag
    return `<${tagName}${attrString}>${innerContent}</${tagName}>`;
}

/**
 * Converts a structured JSON object back to an XML string.
 *
 * @param {object} json - The JSON object to convert.
 * @returns {string} The resulting XML string.
 */
function jsonToXml(json) {
    // Determine the root tag name from the single top-level key
    const rootTagName = Object.keys(json)[0];
    const rootElement = json[rootTagName];

    if (!rootElement || !Array.isArray(rootElement) || rootElement.length === 0) {
        return ''; // Handle empty or malformed root
    }

    // Start with XML declaration
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';

    // The root element in the structure is an array, take the first item
    const rootNode = rootElement[0]; 
    
    // The actual children of the root are stored under the rootTagName key in the rootNode
    const children = rootNode[rootTagName];
    delete rootNode[rootTagName]; // Temporarily remove children to only pass attrs/text

    // Add back the children array under a 'parts' key for the builder to process
    rootNode.parts = children; 

    // Build the root element recursively
    xml += buildNode(rootNode, rootTagName);

    // Revert the temporary change (optional, but good practice)
    rootNode[rootTagName] = children; 

    // Clean up extra spacing
    return xml.replace(/>\s+</g, '><').replace(/></g, '>\n<');
}

module.exports = {xmlToJson, buildNode, jsonToXml }