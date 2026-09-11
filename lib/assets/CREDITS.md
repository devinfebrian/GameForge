# Asset credits

## Kenney sprite packs — CC0 1.0 (public domain)

Curated sprites come from [Kenney](https://kenney.nl) and are released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Attribution is not
required; it is recorded here anyway.

Downloaded by `bun run assets:fetch`, which scrapes each asset page for its archive
link (the URLs embed a per-release hash, so they cannot be hardcoded):

| Pack | Slug | Used for |
| --- | --- | --- |
| Space Shooter Remastered | `space-shooter-remastered` | player/enemy ships, lasers, meteors, power-ups |
| Top-down Shooter | `top-down-shooter` | top-down characters and ground tiles |
| New Platformer Pack | `new-platformer-pack` | platformer characters, enemies, blocks, coins |
| Roguelike Characters | `roguelike-characters` | character sprite sheet |

Note: the packs named in the original plan (Space Shooter Redux, Top-down Shooter,
Platformer Pack Redux, Roguelike/RPG Pack) have been renamed or retired by Kenney. The
slugs above are the current equivalents, verified on 2026-09-11.

## Runtime libraries

| Library | Version | License | Used for |
| --- | --- | --- | --- |
| [Phaser](https://phaser.io) | 3.90.0 | MIT | 2D game framework |
| [jsfxr](https://github.com/chr15m/jsfxr) | 1.4.1 | UNLICENSE (public domain) | Procedural sound effects |

Both are copied into `public/sandbox/vendor/` by `scripts/copy-vendor.ts`, which runs
on `postinstall`. That directory is generated and not committed.

Phaser is pinned to `~3.90.0`. npm's `latest` tag for `phaser` is 4.x, and Phaser 4 is
not a drop-in replacement for the 3.x API the architecture targets, so the pin is
load-bearing: `copy-vendor.ts` refuses to vendor a 4.x build.

## How sprites are stored

The sprite files are deliberately **not** committed. The workflow is:

1. Place the curated PNGs in `assets-src/` (gitignored).
2. List them in `lib/assets/curation.json` with an id, source path, bucket path,
   pack, and tags.
3. Run `bun run assets:sync`, which uploads them to the public `game-assets`
   Supabase Storage bucket and regenerates `lib/assets/catalog.json`.

`catalog.json` and the bucket are the durable record. `assets-src/` can only be
rebuilt by downloading the packs again — that is the accepted trade for keeping
several hundred megabytes of pack data out of git.
