export interface WordDiffToken {
  value: string;
  type: 'equal' | 'added' | 'removed';
}

interface Token {
  value: string;
  key: string;
}

function tokenize(text: string): Token[] {
  return (text.match(/\S+\s*/g) || []).map(value => ({
    value,
    key: value.trim(),
  }));
}

export function diffWords(onRecord: string, captured: string): WordDiffToken[] {
  const left = tokenize(onRecord);
  const right = tokenize(captured);
  const lengths = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0)
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = left[i].key === right[j].key
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const result: WordDiffToken[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (left[i].key === right[j].key) {
      result.push({ value: right[j].value, type: 'equal' });
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      result.push({ value: left[i].value, type: 'removed' });
      i += 1;
    } else {
      result.push({ value: right[j].value, type: 'added' });
      j += 1;
    }
  }

  while (i < left.length) {
    result.push({ value: left[i].value, type: 'removed' });
    i += 1;
  }

  while (j < right.length) {
    result.push({ value: right[j].value, type: 'added' });
    j += 1;
  }

  return result;
}
