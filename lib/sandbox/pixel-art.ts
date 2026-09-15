/**
 * The procedural pixel-art helper injected into every runtime (preview and both
 * export artifacts).
 *
 * It is exposed as a global so generated scene code can call it directly. An
 * earlier design made this a "copy this helper unchanged" instruction to the
 * coder agent; the model sometimes emitted the *call* without the *definition*,
 * which produced `ReferenceError: makeTexturedSprite is not defined` and a blank
 * scene that the boot gate could not catch (the reference is a valid parse).
 * Injecting it here removes that whole failure class.
 *
 * The helper is authored as a string for the same reason the scene is: it runs
 * inside a Blob/classic script in the frame, so it must be plain JavaScript with
 * no imports and no module syntax.
 */
export const PIXEL_ART_HELPER = `function makeTexturedSprite(scene, definition) {
  var pixels = definition.pixels;
  var palette = definition.palette;
  var size = definition.pixelSize || 1;
  var canvas = document.createElement("canvas");
  canvas.width = pixels[0].length * size;
  canvas.height = pixels.length * size;
  var context = canvas.getContext("2d");
  for (var y = 0; y < pixels.length; y += 1) {
    for (var x = 0; x < pixels[y].length; x += 1) {
      var color = palette[pixels[y][x]];
      if (color !== undefined) {
        context.fillStyle = color;
        context.fillRect(x * size, y * size, size, size);
      }
    }
  }
  scene.textures.addCanvas(definition.key, canvas);
}

window.makeTexturedSprite = makeTexturedSprite;`;
