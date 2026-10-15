/**
 * Where an `object-contain` image is actually PAINTED inside its box.
 *
 * The Studio shows the customer's photo (and the render) with `object-contain`,
 * so a portrait photo in a wide canvas is letterboxed: the picture is narrower
 * than the element. Stylist dots are placed at fractions of the PICTURE
 * (e.g. torso at y = 0.32), so they must be mapped onto this rectangle, not
 * onto the element — otherwise every dot drifts into the black margins.
 *
 * @returns {{left:number, top:number, width:number, height:number} | null}
 */
export const containRect = (boxWidth, boxHeight, imageWidth, imageHeight) => {
    if (!boxWidth || !boxHeight || !imageWidth || !imageHeight) return null;

    const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;

    return {
        left: (boxWidth - width) / 2,
        top: (boxHeight - height) / 2,
        width,
        height,
    };
};

/**
 * Default body points (fractions of the picture) used when the photo analysis
 * is unavailable. A verified full-body photo is roughly centred, chest about a
 * third of the way down, thighs past the middle and feet near the bottom.
 */
export const FALLBACK_ANCHORS = {
    torso: { x: 0.5, y: 0.32 },
    legs: { x: 0.5, y: 0.62 },
    feet: { x: 0.5, y: 0.93 },
};

/** Which body point a lookbook slot (or verdict check) points at. */
export const ANCHOR_FOR_SLOT = { upper: 'torso', full: 'torso', lower: 'legs', feet: 'feet' };
