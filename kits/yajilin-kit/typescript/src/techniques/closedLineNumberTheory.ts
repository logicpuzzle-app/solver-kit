/*
 * Yajilin Kit — ported from gridkit `solver/closedLineNumberTheory.ts`.
 *
 * Applies the parity theorem to closed regions rather than rows/columns. Line endpoints
 * are classified as interior to an area, on its boundary, or merely adjacent; the parity
 * of the interior endpoints then decides whether a single boundary endpoint must head
 * into the area or out of it, and detects regions that can no longer be completed.
 */

import { toId, type Board } from "../board.js";
import { equals, type Position } from "../position.js";
import type { ConnectionMap } from "./connectionMap.js";
import type { AnswerMethods } from "../answerMethods.js";
import { Reason } from "../reasons.js";
import type { Status } from "../status.js";

export const closedLineNumberTheory = (
  board: Board,
  answer: AnswerMethods,
  connectionMap: ConnectionMap
): Status => {
  const { map, cells, areaCount } = connectionMap;
  const innerEdge: Position[][] = [...new Array(areaCount)].map(() => []);
  const boundaryEdge: Position[][] = [...new Array(areaCount)].map(() => []);
  const aroundEdge: Position[][] = [...new Array(areaCount)].map(() => []);

  let edges = answer.getAllEdge();
  let edgeCount = edges.length;
  for (;;) {
    edges = edges.filter((pos) => {
      const aroundIds = answer
        .edgeAround(pos)
        .map(({ pos: pos2 }) => map.get(toId(pos2)));
      if (aroundIds.some((e) => e === undefined)) {
        return true;
      }
      const uniqueIds = [...new Set(aroundIds as number[])];
      if (uniqueIds.length === 1) {
        innerEdge[uniqueIds[0]!]!.push(pos);
        map.set(toId(pos), uniqueIds[0]!);
      } else {
        uniqueIds.forEach((id) => {
          boundaryEdge[id]!.push(pos);
        });
      }
      return false;
    });
    if (edges.length === 0) {
      break;
    }
    if (edges.length === edgeCount) {
      edges.forEach((pos) => {
        const aroundIds = answer
          .edgeAround(pos)
          .map(({ pos: pos2 }) => map.get(toId(pos2)));
        const uniqueIds = [
          ...new Set(aroundIds.filter((e) => e !== undefined) as number[]),
        ];
        if (uniqueIds.length === 1) {
          aroundEdge[uniqueIds[0]!]!.push(pos);
        } else {
          uniqueIds.forEach((id) => {
            boundaryEdge[id]!.push(pos);
          });
        }
      });
      break;
    }
    edgeCount = edges.length;
  }

  aroundEdge.forEach((edge, id) => {
    edge.forEach((pos) => {
      if (
        answer
          .edgeAround(pos)
          .filter(({ pos: pos2 }) => !map.has(toId(pos2)))
          .every(
            ({ pos: pos2 }) =>
              edge.some((pos3) => equals(pos2, pos3)) ||
              boundaryEdge[id]!.some((pos3) => equals(pos2, pos3))
          )
      ) {
        innerEdge[id]!.push(pos);
        map.set(toId(pos), id);
      } else {
        boundaryEdge[id]!.push(pos);
      }
    });
  });

  let isAdvanced = false;
  for (let i = 0; i < areaCount; ++i) {
    if (cells[i]!.length === 1 && !answer.hasWhiteCell(cells[i]![0]!)) {
      // A single free cell may simply be filled with black, so it proves nothing.
      continue;
    }

    if (boundaryEdge[i]!.length === 0) {
      if (areaCount >= 2 && innerEdge[i]!.length === 0) {
        return "broken";
      }
      if (innerEdge[i]!.length % 2 === 1) {
        return "broken";
      } else if (
        areaCount >= 2 &&
        new Set(innerEdge[i]!.map((pos) => answer.getEdgeId(pos) as number)).size ===
          innerEdge[i]!.length / 2
      ) {
        return "broken";
      }
    }
    if (boundaryEdge[i]!.length === 1) {
      if (innerEdge[i]!.length % 2 === 0) {
        // The endpoint has to leave the area.
        boundaryEdge[i]!.forEach((pos) => {
          if (isAdvanced) {
            return;
          }
          const next = answer
            .edgeAround(pos)
            .filter(({ pos: pos2 }) => map.get(toId(pos2)) !== i);
          if (next.length === 1) {
            isAdvanced ||= answer.addLine(
              [pos, next[0]!.pos],
              Reason.InvisibleWallByCount
            );
          }
        });
      } else {
        // The endpoint has to head into the area.
        boundaryEdge[i]!.forEach((pos) => {
          if (isAdvanced) {
            return;
          }
          const next = answer
            .edgeAround(pos)
            .filter(({ pos: pos2 }) => map.get(toId(pos2)) === i);
          if (next.length === 1) {
            isAdvanced ||= answer.addLine(
              [pos, next[0]!.pos],
              Reason.InvisibleWallByCount
            );
          }
        });
      }
    }
    if (isAdvanced) {
      return "advanced";
    }
    if (boundaryEdge[i]!.length === 2) {
      if (innerEdge[i]!.length % 2 === 0) {
        if (
          new Set(innerEdge[i]!.map((pos) => answer.getEdgeId(pos) as number)).size ===
          innerEdge[i]!.length / 2
        ) {
          boundaryEdge[i]!.forEach((pos) => {
            if (isAdvanced) {
              return;
            }
            const next = answer
              .edgeAround(pos)
              .filter(({ pos: pos2 }) => map.get(toId(pos2)) === i);
            if (next.length === 1) {
              isAdvanced ||= answer.addLine(
                [pos, next[0]!.pos],
                Reason.InvisibleWallByGlobalSmallLoop
              );
            }
          });
        }
      }
    }
    if (isAdvanced) {
      return "advanced";
    }
  }
  return "stopped";
};
