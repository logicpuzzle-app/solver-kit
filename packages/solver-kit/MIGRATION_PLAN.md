# SDVX Solver Migration Plan

## Overview
- **Total Solvers**: 177
- **Already Migrated**: 95
- **Remaining**: 82
- **Target**: Batch migration in parallel groups

## Already Migrated ✅ (95 solvers)

### Core (10)
1. akari - Light Up puzzle ✅
2. fillomino - Polyomino region division ✅
3. gokigen - Slant/Diagonal puzzle ✅
4. hitori - Shading, no duplicate numbers ✅
5. kakuro - Cross-sum puzzle ✅
6. masyu - Loop with pearls ✅
7. nurikabe - Shading with islands ✅
8. shikaku - Rectangle division ✅
9. slither - Slither Link loop ✅
10. sudoku - Number placement ✅

### Batch 1: Loop Puzzles (14/18) ✅
- simpleloop ✅
- geradeweg ✅
- nanameguri ✅
- pipelink ✅
- snake ✅
- yajilin ✅
- castle ✅
- midloop ✅
- angleloop ✅
- doubleback ✅
- balance ✅
- barns ✅
- koburin ✅
- (Remaining: dotchiloop, ichimaga, nagenawa, ringring, loopsp, meander, mejilink)

### Batch 2: Shading Puzzles (22/22) ✅ COMPLETE
- aqre ✅
- aquarium ✅
- chocona ✅
- creek ✅
- heyawake ✅
- kurodoko ✅
- kurotto ✅
- lits ✅
- mochikoro ✅
- norinori ✅
- nuribou ✅
- nurimaze ✅
- nurimisaki ✅
- shakashaka ✅
- shimaguni ✅
- stostone ✅
- tapa ✅
- bag ✅
- tilepaint ✅
- usoone ✅
- paintarea ✅
- juosan ✅

### Batch 3: Number/Placement Puzzles (18/18) ✅ COMPLETE
- cojun ✅
- countlink ✅
- doppelblock ✅
- easyasabc ✅
- factors ✅
- kropki ✅
- kurochute ✅
- makaro ✅
- minarism ✅
- nanro ✅
- news ✅
- renban ✅
- ripple ✅
- roma ✅
- sukoro ✅
- tasquare ✅
- view ✅
- yajikazu ✅

### Batch 4: Region Division Puzzles (9/15)
- chblock ✅
- dominion ✅
- heteromino ✅
- nawabari ✅
- sashigane ✅
- tatamibari ✅
- pentomino ✅
- fillmat ✅
- hanare ✅
- (Remaining: heyabon, oneroom, tetrochain, yregions, dominofield, squarejam, rectslider)

### Batch 5: Path/Connection Puzzles (7/15)
- hashikake ✅
- numlin/arukone ✅
- compass ✅
- firefly ✅
- icebarn ✅
- detour ✅
- satogaeri ✅
- (Remaining: context, guidearrow, herugolf, icelom, reflect, slalom, tren, waterwalk)

### Batch 6: Object Placement Puzzles (11/15)
- battleship ✅
- starbattle ✅
- tents ✅
- yinyang ✅
- mines ✅
- moonsun ✅
- dosufuwa ✅
- clouds ✅
- hakoiri ✅
- chocobanana ✅
- dbchoko ✅
- (Remaining: hebi, lollipops, mannequin, pencils, shugaku, takoyaki, cocktail, oyakodori)

### Batch 7: Visibility/Line of Sight Puzzles (4/12)
- building ✅
- skyscrapers ✅
- lookair ✅
- tentaisho ✅
- (Remaining: myopia, hoshizora, invlitso, kurarin, las, scrin, nothing, nothree)

### Batch 9: Miscellaneous (1/20)
- nonogram ✅
- (Remaining: many)

---

## Remaining Work by Batch

### Batch 1: Loop Puzzles (7 remaining)
| # | Puzzle | Description | Priority |
|---|--------|-------------|----------|
| 1 | balance | Loop balancing puzzle | Medium |
| 2 | barns | Loop around barns | Medium |
| 3 | dotchiloop | Loop variant | Medium |
| 4 | ichimaga | Loop with magnets | Medium |
| 5 | nagenawa | Lasso loop puzzle | Medium |
| 6 | ringring | Ring connection | Medium |
| 7 | loopsp | Loop special | Medium |
| 8 | meander | Meandering path | Medium |
| 9 | mejilink | Link puzzle | Medium |

### Batch 2: Shading Puzzles (3 remaining)
| # | Puzzle | Description | Priority |
|---|--------|-------------|----------|
| 1 | cave/bag | Cave shading | Medium |
| 2 | paintarea | Area painting | Medium |
| 3 | tilepaint | Tile painting | Medium |

### Batch 4: Region Division Puzzles (9 remaining)
| # | Puzzle | Description | Priority |
|---|--------|-------------|----------|
| 1 | heyabon | Room division | Medium |
| 2 | oneroom | Single room | Medium |
| 3 | pentomino | Pentomino placement | High |
| 4 | tetrochain | Tetromino chain | Medium |
| 5 | yregions | Y-shaped regions | Medium |
| 6 | fillmat | Fill with mats | Medium |
| 7 | dominofield | Domino field | Medium |
| 8 | squarejam | Square jam | Medium |
| 9 | rectslider | Rectangle slider | Medium |

### Batch 5: Path/Connection Puzzles (14 remaining)
| # | Puzzle | Description | Priority |
|---|--------|-------------|----------|
| 1 | arukone/numlin | Number link | High |
| 2 | compass | Compass directions | Medium |
| 3 | context | Context puzzle | Medium |
| 4 | detour | Detour path | Medium |
| 5 | firefly | Firefly path | Medium |
| 6 | guidearrow | Arrow guidance | Medium |
| 7 | herugolf | Golf path | Medium |
| 8 | icebarn | Ice barn path | Medium |
| 9 | icelom | Ice path variant | Medium |
| 10 | reflect | Reflection path | Medium |
| 11 | satogaeri | Return home path | Medium |
| 12 | slalom | Slalom path | Medium |
| 13 | tren | Train path | Medium |
| 14 | waterwalk | Water walk | Medium |

### Batch 6: Object Placement Puzzles (11 remaining)
| # | Puzzle | Description | Priority |
|---|--------|-------------|----------|
| 1 | clouds | Cloud placement | Medium |
| 2 | mines | Minesweeper variant | High |
| 3 | hakoiri | Box puzzle | Medium |
| 4 | hebi | Snake placement | Medium |
| 5 | lollipops | Lollipop placement | Medium |
| 6 | mannequin | Mannequin puzzle | Medium |
| 7 | moonsun | Moon and sun | Medium |
| 8 | pencils | Pencil placement | Medium |
| 9 | shugaku | School placement | Medium |
| 10 | takoyaki | Takoyaki placement | Medium |
| 11 | cocktail | Cocktail glass | Medium |
| 12 | oyakodori | Parent-child birds | Medium |

### Batch 7: Visibility/Line of Sight Puzzles (12 remaining)
| # | Puzzle | Description | Priority |
|---|--------|-------------|----------|
| 1 | building | Building heights | High |
| 2 | lookair | Look and air | Medium |
| 3 | myopia | Near-sighted view | Medium |
| 4 | skyscrapers/bag | Skyscraper puzzle | High |
| 5 | tentaisho | Stargazing | Medium |
| 6 | hoshizora | Star sky | Medium |
| 7 | invlitso | Inverse litso | Medium |
| 8 | kurarin | Kurarin puzzle | Medium |
| 9 | las | Line of sight | Medium |
| 10 | scrin | Screen puzzle | Medium |
| 11 | nothing | Nothing to see | Medium |
| 12 | nothree | No three in line | Medium |

### Batch 8-10: Miscellaneous (52 remaining)
Lower priority puzzles - see original list.

---

## Progress Summary

| Batch | Category | Completed | Total | % |
|-------|----------|-----------|-------|---|
| Core | Core puzzles | 10 | 10 | 100% |
| 1 | Loop Puzzles | 14 | 18 | 78% |
| 2 | Shading Puzzles | 22 | 22 | **100%** |
| 3 | Number/Placement | 18 | 18 | **100%** |
| 4 | Region Division | 9 | 15 | 60% |
| 5 | Path/Connection | 7 | 15 | 47% |
| 6 | Object Placement | 11 | 15 | 73% |
| 7 | Visibility | 4 | 12 | 33% |
| 8-10 | Miscellaneous | 2 | 54 | 4% |
| **Total** | | **95** | **177** | **54%** |

---

## Next Priority Tasks

### High Priority Remaining (All Completed!)
1. ~~pentomino (Region) - Popular polyomino puzzle~~ ✅
2. ~~arukone/numlin (Path) - Number link, very popular~~ ✅
3. ~~mines (Placement) - Minesweeper variant~~ ✅
4. ~~building (Visibility) - Skyscraper heights~~ ✅
5. ~~skyscrapers (Visibility) - Classic puzzle~~ ✅

### Medium Priority - Complete Batches
1. ~~Finish Batch 2 (3 puzzles) - cave, paintarea, tilepaint~~ ✅ **COMPLETE**
2. Finish Batch 1 (6 puzzles) - barns, dotchiloop, ichimaga, nagenawa, ringring, loopsp, meander, mejilink

---

## File Structure

```
src/solvers/
├── index.ts              # Export all solvers (95 exports)
├── [core puzzles]        ✅ 10 files
├── [batch1 - loop]       ✅ 14 files
├── [batch2 - shading]    ✅ 22 files (COMPLETE)
├── [batch3 - number]     ✅ 18 files (COMPLETE)
├── [batch4 - region]     ✅ 9 files
├── [batch5 - path]       ✅ 7 files
├── [batch6 - placement]  ✅ 11 files
├── [batch7 - visibility] ✅ 4 files
└── [misc]                ✅ 2 files
```

---

## Notes

- Each solver follows the `FieldState<T>` / `BaseSolver<T>` pattern
- Use existing types from `core/types.ts` where possible
- FieldState requires `height` and `width` properties
- Run `npm run build` after each batch to verify compilation
