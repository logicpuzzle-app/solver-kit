use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::LOCAL_PATTERN;
use crate::status::Status;

const TABLE: &[u8] = include_bytes!("local_pattern_table.bin");
const HEADER_BYTES: usize = 24;
const TOTAL_KEYS: usize = 1_953_125;
const BLOCK_SIZE: usize = 256;

fn read_u32(offset: usize) -> u32 {
    u32::from_le_bytes(
        TABLE[offset..offset + 4]
            .try_into()
            .expect("埋め込みテーブルのu32境界は生成時に保証される"),
    )
}

fn read_u64(offset: usize) -> u64 {
    u64::from_le_bytes(
        TABLE[offset..offset + 8]
            .try_into()
            .expect("埋め込みテーブルのu64境界は生成時に保証される"),
    )
}

fn table_layout() -> (usize, usize, usize) {
    let block_count = read_u32(20) as usize;
    let bitmap_start = HEADER_BYTES + (block_count + 1) * 4;
    let bitmap_bytes = TOTAL_KEYS.div_ceil(8);
    let values_start = bitmap_start + bitmap_bytes;
    (block_count, bitmap_start, values_start)
}

fn lookup(key: u32) -> Option<u64> {
    let key = key as usize;
    if key >= TOTAL_KEYS {
        return None;
    }
    let (block_count, bitmap_start, values_start) = table_layout();
    let byte = TABLE[bitmap_start + key / 8];
    if byte & (1 << (key % 8)) == 0 {
        return None;
    }

    let block = key / BLOCK_SIZE;
    debug_assert!(block < block_count);
    let mut rank = read_u32(HEADER_BYTES + block * 4) as usize;
    let within = key % BLOCK_SIZE;
    let block_bitmap = bitmap_start + block * (BLOCK_SIZE / 8);
    for word in 0..within / 64 {
        rank += read_u64(block_bitmap + word * 8).count_ones() as usize;
    }
    let bit = within % 64;
    if bit > 0 {
        rank += (read_u64(block_bitmap + (within / 64) * 8)
            & ((1u64 << bit) - 1))
            .count_ones() as usize;
    }

    let offset = values_start + rank * 6;
    let mut encoded = [0u8; 8];
    encoded[..6].copy_from_slice(&TABLE[offset..offset + 6]);
    Some(u64::from_le_bytes(encoded))
}

fn clue_key(answer: &AnswerMethods<'_>, start_x: usize, start_y: usize) -> Option<u32> {
    let mut key = 0u32;
    let mut power = 1u32;
    for y in start_y..start_y + 3 {
        for x in start_x..start_x + 3 {
            let clue = answer.board.clue(x, y);
            if !(-1..=3).contains(&clue) {
                return None;
            }
            key += (clue + 1) as u32 * power;
            power *= 5;
        }
    }
    Some(key)
}

fn board_edge(
    answer: &AnswerMethods<'_>,
    start_x: usize,
    start_y: usize,
    local_edge: usize,
) -> usize {
    if local_edge < 12 {
        answer.board.h_id(
            start_x + local_edge % 3,
            start_y + local_edge / 3,
        )
    } else {
        let offset = local_edge - 12;
        answer.board.v_id(
            start_x + offset % 4,
            start_y + offset / 4,
        )
    }
}

/// ヒントだけで決まるため、ソルバー開始時に一度だけ全3x3窓へ適用する。
pub fn local_pattern(answer: &mut AnswerMethods<'_>) -> Status {
    if answer.board.cols < 3 || answer.board.rows < 3 {
        return Status::Stopped;
    }
    let mut result = Status::Stopped;
    for start_y in 0..=answer.board.rows - 3 {
        for start_x in 0..=answer.board.cols - 3 {
            let Some(key) = clue_key(answer, start_x, start_y) else {
                continue;
            };
            let Some(mask) = lookup(key) else {
                continue;
            };
            for local_edge in 0..24 {
                let state = match (mask >> (local_edge * 2)) & 3 {
                    0 => continue,
                    1 => EdgeState::Line,
                    2 => EdgeState::Cross,
                    _ => return Status::Broken,
                };
                let edge =
                    board_edge(answer, start_x, start_y, local_edge);
                result = merge_status(
                    result,
                    answer.set_edge(edge, state, LOCAL_PATTERN),
                );
                // 同じ辺を覆う別の窓や既存状態と食い違う場合も即座に壊す。
                if result == Status::Broken {
                    return result;
                }
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_table_header_and_length_are_consistent() {
        assert_eq!(&TABLE[..8], b"SLP3TB01");
        assert_eq!(read_u32(8) as usize, TOTAL_KEYS);
        assert_eq!(read_u32(16) as usize, BLOCK_SIZE);
        let entries = read_u32(12) as usize;
        let (block_count, _, values_start) = table_layout();
        assert_eq!(block_count, TOTAL_KEYS.div_ceil(BLOCK_SIZE));
        assert_eq!(TABLE.len(), values_start + entries * 6);
    }

    #[test]
    fn empty_three_by_three_has_no_forced_edges() {
        assert_eq!(lookup(0), None);
    }
}
