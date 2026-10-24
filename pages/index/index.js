Page({
  data: {
    currentPlayerText: '黑棋',
    gameOverText: '',
    stepInfo: '第 0 / 0 步'
  },

  onReady() {
    this.initCanvas();
  },

  initCanvas() {
    wx.createSelectorQuery()
      .select('#myCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0] || !res[0].node) return;
        
        this.canvas = res[0].node;
        this.ctx = this.canvas.getContext('2d');
        
        const dpr = wx.getWindowInfo().pixelRatio;
        this.dpr = dpr;
        this.canvas.width = res[0].width * dpr;
        this.canvas.height = res[0].height * dpr;
        this.ctx.scale(dpr, dpr);

        this.boardSize = Math.min(res[0].width, res[0].height);
        this.padding = 20;
        this.cell = (this.boardSize - this.padding * 2) / 14;

        this.resetGame();
      });
  },

  resetGame() {
    this.boardData = Array.from({ length: 15 }, () => Array(15).fill(0));
    this.currentPlayer = 1;
    this.history = [];
    this.isGameOver = false;
    this.viewIndex = 0; // 当前浏览的步数

    this.setData({
      currentPlayerText: '黑棋',
      gameOverText: '',
      stepInfo: '第 0 / 0 步'
    });

    this.drawBoard();
  },

  drawBoard() {
    const ctx = this.ctx;
    const width = this.boardSize;
    const padding = this.padding;
    const cell = this.cell;

    // 底色
    ctx.fillStyle = '#e8c878';
    ctx.fillRect(0, 0, width, width);

    // 网格线
    ctx.strokeStyle = '#3a2a10';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 15; i++) {
      ctx.moveTo(padding, padding + i * cell);
      ctx.lineTo(width - padding, padding + i * cell);
      ctx.moveTo(padding + i * cell, padding);
      ctx.lineTo(padding + i * cell, width - padding);
    }
    ctx.stroke();

    // 星位
    ctx.fillStyle = '#3a2a10';
    const starPoints = [[3, 3], [11, 3], [3, 11], [11, 11], [7, 7]];
    starPoints.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(padding + x * cell, padding + y * cell, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // 根据 viewIndex 只渲染到当前浏览的步骤
    for (let i = 0; i < this.viewIndex; i++) {
      const step = this.history[i];
      this.drawStone(step.x, step.y, step.player, i === this.viewIndex - 1);
    }
  },

  // 画棋子
  drawStone(x, y, color, isLast) {
    const ctx = this.ctx;
    const cx = this.padding + x * this.cell;
    const cy = this.padding + y * this.cell;
    const r = this.cell * 0.42;

    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(cx + 2, cy + 2, r, 0, Math.PI * 2);
    ctx.fill();

    // 棋子渐变
    const gradient = ctx.createRadialGradient(cx - r*0.3, cy - r*0.3, r*0.1, cx, cy, r);
    if (color === 1) {
      gradient.addColorStop(0, '#666');
      gradient.addColorStop(1, '#000');
    } else {
      gradient.addColorStop(0, '#fff');
      gradient.addColorStop(1, '#bbb');
    }
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    
    // 描边
    ctx.strokeStyle = color === 1 ? '#000' : '#888';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // 如果是最后一步，画红点
    if (isLast) {
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  onCanvasTap(e) {
    if (!this.ctx || this.isGameOver) return;
    
    if (this.viewIndex < this.history.length) {
      wx.showToast({ title: '请先点击"下一步"回到最终盘面', icon: 'none' });
      return;
    }

    const touch = e.touches[0] || e.changedTouches[0];
    if (!touch) return;

    const touchX = touch.x;
    const touchY = touch.y;

    const x = Math.round((touchX - this.padding) / this.cell);
    const y = Math.round((touchY - this.padding) / this.cell);

    if (x < 0 || x >= 15 || y < 0 || y >= 15) return;
    if (this.boardData[y][x] !== 0) return;

    // 落子
    this.boardData[y][x] = this.currentPlayer;
    this.history.push({ x, y, player: this.currentPlayer });
    this.viewIndex = this.history.length;

    // 检查胜负
    if (this.checkWin(x, y, this.currentPlayer)) {
      this.isGameOver = true;
      const winner = this.currentPlayer === 1 ? '黑棋' : '白棋';
      this.setData({ gameOverText: `${winner} 获胜！` });
      wx.showToast({ title: `${winner} 获胜！`, icon: 'none' });
    } else {
      // 切换玩家
      this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
      this.setData({
        currentPlayerText: this.currentPlayer === 1 ? '黑棋' : '白棋'
      });
    }

    this.updateStepInfo();
    this.drawBoard();
  },

  // 胜负判定
  checkWin(x, y, player) {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (let [dx, dy] of dirs) {
      let count = 1;
      for (let i = 1; i < 5; i++) {
        let nx = x + dx * i, ny = y + dy * i;
        if (nx >= 0 && nx < 15 && ny >= 0 && ny < 15 && this.boardData[ny][nx] === player) count++; else break;
      }
      for (let i = 1; i < 5; i++) {
        let nx = x - dx * i, ny = y - dy * i;
        if (nx >= 0 && nx < 15 && ny >= 0 && ny < 15 && this.boardData[ny][nx] === player) count++; else break;
      }
      if (count >= 5) return true;
    }
    return false;
  },

  updateStepInfo() {
    this.setData({
      stepInfo: `第 ${this.viewIndex} / ${this.history.length} 步`
    });
  },

  prevStep() {
    if (this.viewIndex > 0) {
      this.viewIndex--;
      this.updateStepInfo();
      this.drawBoard();
    }
  },

  nextStep() {
    if (this.viewIndex < this.history.length) {
      this.viewIndex++;
      this.updateStepInfo();
      this.drawBoard();
    }
  },

  undo() {
    if (this.history.length === 0) return;
    
    if (this.viewIndex < this.history.length) {
      this.viewIndex = this.history.length;
      this.updateStepInfo();
      this.drawBoard();
      return;
    }

    const lastMove = this.history.pop();
    this.boardData[lastMove.y][lastMove.x] = 0;
    this.currentPlayer = lastMove.player;
    this.viewIndex = this.history.length;
    this.isGameOver = false;

    this.setData({
      currentPlayerText: this.currentPlayer === 1 ? '黑棋' : '白棋',
      gameOverText: ''
    });
    
    this.updateStepInfo();
    this.drawBoard();
  },

  pointToLabel(x, y) {
    const col = String.fromCharCode(65 + x);
    const row = 15 - y;
    return col + row;
  },

  labelToPoint(label) {
    const colStr = label.charAt(0).toUpperCase();
    const rowStr = label.slice(1);
    const x = colStr.charCodeAt(0) - 65;
    const y = 15 - parseInt(rowStr, 10);
    return { x, y };
  },

  exportMoveSeq() {
    if (this.history.length === 0) {
      wx.showToast({ title: '当前没有棋谱可导出', icon: 'none' });
      return;
    }
    
    let seqStr = '';
    this.history.forEach(step => {
      seqStr += this.pointToLabel(step.x, step.y);
    });

    wx.setClipboardData({
      data: seqStr,
      success: () => {
        wx.showModal({
          title: '导出成功',
          content: `落子顺序：\n${seqStr}\n\n已复制到剪切板`,
          showCancel: false
        });
      }
    });
  },

  importMoveSeq() {
    wx.showModal({
      title: '导入棋谱',
      editable: true,
      placeholderText: '例如: H8I9G7...',
      success: (res) => {
        if (res.confirm && res.content) {
          this.processImport(res.content);
        }
      }
    });
  },

  processImport(inputStr) {
    const regex = /([A-Oa-o])(1[0-5]|[1-9])/g;
    const matches = inputStr.match(regex);
    
    if (!matches || matches.length === 0) {
      wx.showToast({ title: '未识别到有效棋谱', icon: 'none' });
      return;
    }

    this.resetGame();

    let validCount = 0;
    for (let i = 0; i < matches.length; i++) {
      const { x, y } = this.labelToPoint(matches[i]);
      
      if (x >= 0 && x < 15 && y >= 0 && y < 15) {
        if (this.boardData[y][x] === 0) {
          const player = (i % 2 === 0) ? 1 : 2; 
          this.boardData[y][x] = player;
          this.history.push({ x, y, player });
          validCount++;
        }
      }
    }

    if (validCount > 0) {
      this.viewIndex = this.history.length;
      this.currentPlayer = (validCount % 2 === 0) ? 1 : 2;
      
      this.setData({
        currentPlayerText: this.currentPlayer === 1 ? '黑棋' : '白棋'
      });
      
      this.updateStepInfo();
      this.drawBoard();
      wx.showToast({ title: `成功导入 ${validCount} 步`, icon: 'none' });
    } else {
      wx.showToast({ title: '棋谱格式有误或无有效落子', icon: 'none' });
    }
  },

  restart() {
    this.resetGame();
  }
})