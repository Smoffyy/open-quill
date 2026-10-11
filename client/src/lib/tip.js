export const TIP_DELAY = 500;
export const TIP_GAP = 5.3;
export const TIP_EDGE = 8;
export const TIP_CURSOR_X = 12;
export const TIP_CURSOR_Y = 18;
export const TIP_FLIP_GAP = 4;

export function placeAtCursor({ x, y, width, height, vw, vh }) {
  const right = x + TIP_CURSOR_X;
  const left = right + width > vw - TIP_EDGE ? x - TIP_FLIP_GAP - width : right;
  const below = y + TIP_CURSOR_Y;
  const top = below + height > vh - TIP_EDGE ? y - TIP_FLIP_GAP - height : below;
  return { top: Math.max(TIP_EDGE, top), left: Math.max(TIP_EDGE, left) };
}

export function placeTip({ anchor, width, height, side, pointY, vw, vh }) {
  if (side === 'right') {
    const y = pointY ?? anchor.top + anchor.height / 2;
    return {
      top: Math.min(Math.max(TIP_EDGE, y - height / 2), vh - height - TIP_EDGE),
      left: Math.min(anchor.right + TIP_GAP, vw - width - TIP_EDGE)
    };
  }
  const below = side !== 'top' && anchor.bottom + TIP_GAP + height + TIP_EDGE <= vh;
  const top = below ? anchor.bottom + TIP_GAP : Math.max(TIP_EDGE, anchor.top - TIP_GAP - height);
  const left = Math.min(Math.max(TIP_EDGE, anchor.left + anchor.width / 2 - width / 2), vw - width - TIP_EDGE);
  return { top, left };
}