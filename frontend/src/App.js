import "./App.scss";
import React from 'react';
import BN from 'bn.js';
import * as nearAPI from 'near-api-js'
import { HuePicker, GithubPicker } from 'react-color'
import Switch from "react-switch"

const PixelPrice = new BN("10000000000000000000000");
const IsMainnet = true;
const TestNearConfig = {
  networkId: 'testnet',
  nodeUrl: 'https://rpc.testnet.near.org',
  contractName: 'dev-1604708520705-2360364',
  walletUrl: 'https://wallet.testnet.near.org',
};
const MainNearConfig = {
  networkId: 'mainnet',
  nodeUrl: 'https://rpc.mainnet.near.org',
  contractName: 'berryclub.ek.near',
  walletUrl: 'https://wallet.near.org',
};
const NearConfig = IsMainnet ? MainNearConfig : TestNearConfig;

const Avocado = <span role="img" aria-label="avocado" className="berry">🥑</span>;
const Banana = <span role="img" aria-label="banana" className="berry">🍌</span>;

const Berry = {
  Avocado: 'Avocado',
  Banana: 'Banana',
};

const BoardHeight = 50;
const BoardWidth = 50;
const NumLinesPerFetch = 10;
const ExpectedLineLength = 4 + 8 * BoardWidth;
const CellWidth = 16;
const CellHeight = 16;
const MaxNumColors = 31;
const BatchOfPixels = 30;
// 500 ms
const BatchTimeout = 500;
const RefreshBoardTimeout = 1000;
const MaxWorkTime = 10 * 60 * 1000;

const intToColor = (c) => `#${c.toString(16).padStart(6, '0')}`;
const int2hsv = (cInt) => {
  cInt = intToColor(cInt).substr(1)
  const r = parseInt(cInt.substr(0, 2), 16) / 255
  const g = parseInt(cInt.substr(2, 2), 16) / 255
  const b = parseInt(cInt.substr(4, 2), 16) / 255
  let v=Math.max(r,g,b), c=v-Math.min(r,g,b);
  let h= c && ((v===r) ? (g-b)/c : ((v===g) ? 2+(b-r)/c : 4+(r-g)/c));
  return [60*(h<0?h+6:h), v&&c/v, v];
}
const transparentColor = (c, a) => `rgba(${(c >> 16) / 1}, ${((c >> 8) & 0xff) / 1}, ${(c & 0xff) / 1}, ${a})`
const generateGamma = (hue) => {
  const gammaColors = [];
  for (let i = 0; i < MaxNumColors; ++i) {
    gammaColors.push(`hsl(${hue}, 100%, ${100 * i / (MaxNumColors - 1)}%)`);
  }
  return gammaColors;
};
const decodeLine = (line) => {
  let buf = Buffer.from(line, 'base64');
  if (buf.length !== ExpectedLineLength) {
    throw new Error("Unexpected encoded line length");
  }
  let pixels = []
  for (let i = 4; i < buf.length; i += 8) {
    let color = buf.readUInt32LE(i);
    let ownerIndex = buf.readUInt32LE(i + 4);
    pixels.push({
      color,
      ownerIndex,
    })
  }
  return pixels;
};

class App extends React.Component {
  constructor(props) {
    super(props);

    const colors = ["#000000", "#666666", "#aaaaaa", "#FFFFFF", "#F44E3B", "#D33115", "#9F0500", "#FE9200", "#E27300", "#C45100", "#FCDC00", "#FCC400", "#FB9E00", "#DBDF00", "#B0BC00", "#808900", "#A4DD00", "#68BC00", "#194D33", "#68CCCA", "#16A5A5", "#0C797D", "#73D8FF", "#009CE0", "#0062B1", "#AEA1FF", "#7B64FF", "#653294", "#FDA1FF", "#FA28FF", "#AB149E"].map((c) => c.toLowerCase());
    const currentColor = parseInt(colors[Math.floor(Math.random() * colors.length)].substring(1), 16);

    this.state = {
      connected: false,
      signedIn: false,
      accountId: null,
      pendingPixels: 0,
      boardLoaded: false,
      selectedCell: null,
      currentColor,
      pickerColor: intToColor(currentColor),
      colors,
      gammaColors: generateGamma(0),
      pickingColor: false,
      owners: [],
      accounts: {},
      highlightedAccountIndex: -1,
      selectedOwnerIndex: false,
      farmingBanana: false,
    };

    this._buttonDown = false;
    this._oldCounts = {};
    this._numFailedTxs = 0;
    this._balanceRefreshTimer = null;
    this.canvasRef = React.createRef();
    this._context = false;
    this._lines = false;
    this._queue = [];
    this._pendingPixels = [];
    this._refreshBoardTimer = null;
    this._sendQueueTimer = null;
    this._stopRefreshTime = new Date().getTime() + MaxWorkTime;
    this._accounts = {};

    this._initNear().then(() => {
      this.setState({
        connected: true,
        signedIn: !!this._accountId,
        accountId: this._accountId,
      });
    });
  }

  componentDidMount() {
    const canvas = this.canvasRef.current;
    this._context = canvas.getContext('2d');

    const mouseMove = (e) => {
      let x, y;
      if ('touches' in e) {
        if (e.touches.length > 1) {
          return true;
        } else {
          const rect = e.target.getBoundingClientRect();
          x = e.targetTouches[0].clientX - rect.left;
          y = e.targetTouches[0].clientY - rect.top;
        }
      } else {
        x = e.offsetX;
        y = e.offsetY;
      }
      x = Math.trunc(x / e.target.clientWidth * BoardWidth);
      y = Math.trunc(y / e.target.clientHeight * BoardWidth);
      let cell = null;
      if (x >= 0 && x < BoardWidth && y >= 0 && y < BoardHeight) {
        cell = { x, y };
      }
      if (JSON.stringify(cell) !== JSON.stringify(this.state.selectedCell)) {
        this.setState({
          selectedCell: cell,
          selectedOwnerIndex: this._lines && cell && this._lines[cell.y] && this._lines[cell.y][cell.x].ownerIndex
        }, async () => {
          this.renderCanvas()
          if (this.state.selectedCell !== null && this._buttonDown) {
            if (this.state.pickingColor) {
              this.pickColor(this.state.selectedCell);
            } else {
              this.saveColor();
              await this.drawPixel(this.state.selectedCell);
            }
          }
        })
      }
      e.preventDefault();
      return false;
    };

    canvas.addEventListener('mousemove', mouseMove);
    canvas.addEventListener('touchmove', mouseMove);

    const mouseDown = async (e) => {
      this._buttonDown = true;
      if (this.state.selectedCell !== null) {
        if (this.state.pickingColor) {
          this.pickColor(this.state.selectedCell);
        } else {
          this.saveColor();
          await this.drawPixel(this.state.selectedCell);
        }
      }
    };

    canvas.addEventListener('mousedown', mouseDown);
    canvas.addEventListener('touchstart', mouseDown);

    const unselectCell = () => {
      this.setState({
        selectedCell: null,
      }, () => this.renderCanvas());
    }

    const mouseUp = async (e) => {
      this._buttonDown = false;
      if ('touches' in e) {
        unselectCell();
      }
    }

    canvas.addEventListener('mouseup', mouseUp);
    canvas.addEventListener('touchend', mouseUp);

    canvas.addEventListener('mouseleave', unselectCell);

    canvas.addEventListener('mouseenter', (e) => {
      if (this._buttonDown) {
        if (!('touches' in e) && !(e.buttons & 1)) {
          this._buttonDown = false;
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      e.altKey && this.enablePickColor()
    })

    document.addEventListener('keyup', (e) => {
      !e.altKey && this.disablePickColor()
    })
  }

  enablePickColor() {
    this.setState({
      pickingColor: true,
    }, () => {
      this.renderCanvas()
    });
  }

  disablePickColor() {
    this.setState({
      pickingColor: false,
    }, () => {
      this.renderCanvas()
    });
  }

  pickColor(cell) {
    if (!this.state.signedIn || !this._lines || !this._lines[cell.y]) {
      return;
    }
    const color = this._lines[cell.y][cell.x].color;

    console.log(int2hsv(color))

    this.setState({
      currentColor: color,
      pickerColor: intToColor(color),
      gammaColors: generateGamma(int2hsv(color)[0]),
      pickingColor: false,
    }, () => {
      this.renderCanvas()
    });
  }

  async _sendQueue() {
    const pixels = this._queue.slice(0, BatchOfPixels);
    this._queue = this._queue.slice(BatchOfPixels);
    this._pendingPixels = pixels;

    try {
      await this._contract.draw({
        pixels
      }, new BN("75000000000000"));
      this._numFailedTxs = 0;
    } catch (error) {
      console.log("Failed to send a transaction", error);
      this._numFailedTxs += 1;
      if (this._numFailedTxs < 3) {
        this._queue = this._queue.concat(this._pendingPixels);
        this._pendingPixels = [];
      } else {
        this._pendingPixels = [];
        this._queue = [];
      }
    }
    try {
      await Promise.all([this.refreshBoard(true), this.refreshAccountStats()]);
    } catch (e) {
      // ignore
    }
    this._pendingPixels.forEach((p) => {
      if (this._pending[p.y][p.x] === p.color)
      {
       this._pending[p.y][p.x] = -1;
      }
    });
    this._pendingPixels = [];
  }

  async _pingQueue(ready) {
    if (this._sendQueueTimer) {
      clearTimeout(this._sendQueueTimer);
      this._sendQueueTimer = null;
    }

    if (this._pendingPixels.length === 0 && (this._queue.length >= BatchOfPixels || ready)) {
      await this._sendQueue();
    }
    if (this._queue.length > 0) {
      this._sendQueueTimer = setTimeout(async () => {
        await this._pingQueue(true);
      }, BatchTimeout);
    }

  }

  async drawPixel(cell) {
    if (!this.state.signedIn || !this._lines || !this._lines[cell.y]) {
      return;
    }
    const balance = this.state.account ? this.state.account.avocadoBalance : 0;
    if (balance - this.state.pendingPixels < 1) {
      return;
    }

    if (this._pending[cell.y][cell.x] !== this.state.currentColor && this._lines[cell.y][cell.x].color !== this.state.currentColor) {
      this._pending[cell.y][cell.x] = this.state.currentColor;
    } else {
      return;
    }

    this._queue.push({
      x: cell.x,
      y: cell.y,
      color: this.state.currentColor,
    });

    this._stopRefreshTime = new Date().getTime() + MaxWorkTime;
    await this._pingQueue(false);
  }

  parseAccount(account, accountId) {
    if (!account) {
      account = {
        accountId,
        accountIndex: -1,
        avocadoBalance: 25.0,
        bananaBalance: 0.0,
        numPixels: 0,
        farmingPreference: Berry.Avocado,
      }
    } else {
      account = {
        accountId: account.account_id,
        accountIndex: account.account_index,
        avocadoBalance: parseFloat(account.avocado_balance) / this._pixelCost,
        bananaBalance: parseFloat(account.banana_balance) / this._pixelCost,
        numPixels: account.num_pixels,
        farmingPreference: account.farming_preference,
      }
    }
    account.startTime = new Date().getTime();
    account.avocadoPixels = (account.farmingPreference === Berry.Avocado) ? (account.numPixels + 1) : 0;
    account.bananaPixels = (account.farmingPreference === Berry.Banana) ? (account.numPixels) : 0;
    account.avocadoRewardPerMs = account.avocadoPixels / (24 * 60 * 60 * 1000);
    account.bananaRewardPerMs = account.bananaPixels / (24 * 60 * 60 * 1000);
    return account;
  }

  async getAccount(accountId) {
    return this.parseAccount(
      await this._contract.get_account({account_id: accountId}),
      accountId
    );
  }

  async getAccountByIndex(accountIndex) {
    return this.parseAccount(
      await this._contract.get_account_by_index({account_index: accountIndex}),
      "unknown",
    );
  }

  async refreshAccountStats() {
    let account = await this.getAccount(this._accountId);
    if (this._balanceRefreshTimer) {
      clearInterval(this._balanceRefreshTimer);
      this._balanceRefreshTimer = null;
    }

    this.setState({
      pendingPixels: this._pendingPixels.length + this._queue.length,
      farmingBanana: account.farmingPreference === Berry.Banana,
      account,
    });

    this._balanceRefreshTimer = setInterval(() => {
      const t = new Date().getTime() - account.startTime;
      this.setState({
        account: Object.assign({}, account, {
          avocadoBalance: account.avocadoBalance + t * account.avocadoRewardPerMs,
          bananaBalance: account.bananaBalance + t * account.bananaRewardPerMs,
        }),
        pendingPixels: this._pendingPixels.length + this._queue.length,
      });
    }, 100);
  }

  async _initNear() {
    const keyStore = new nearAPI.keyStores.BrowserLocalStorageKeyStore();
    const near = await nearAPI.connect(Object.assign({ deps: { keyStore } }, NearConfig));
    this._keyStore = keyStore;
    this._near = near;

    this._walletConnection = new nearAPI.WalletConnection(near, NearConfig.contractName);
    this._accountId = this._walletConnection.getAccountId();

    this._account = this._walletConnection.account();
    this._contract = new nearAPI.Contract(this._account, NearConfig.contractName, {
      viewMethods: ['get_account', 'get_account_by_index', 'get_lines', 'get_line_versions', 'get_pixel_cost', 'get_account_balance', 'get_account_num_pixels', 'get_account_id_by_index'],
      changeMethods: ['draw', 'buy_tokens', 'select_farming_preference'],
    });
    this._pixelCost = parseFloat(await this._contract.get_pixel_cost());
    if (this._accountId) {
      await this.refreshAccountStats();
    }
    this._lineVersions = Array(BoardHeight).fill(-1);
    this._lines = Array(BoardHeight).fill(false);
    this._pending = Array(BoardHeight).fill(false);
    this._pending.forEach((v, i, a) => a[i] = Array(BoardWidth).fill(-1));
    await this.refreshBoard(true);
  }

  async refreshBoard(forced) {
    if (this._refreshBoardTimer) {
      clearTimeout(this._refreshBoardTimer);
      this._refreshBoardTimer = null;
    }
    const t = new Date().getTime();
    if (t < this._stopRefreshTime) {
      this._refreshBoardTimer = setTimeout(async () => {
        await this.refreshBoard(false);
      }, RefreshBoardTimeout);
    }

    if (!forced && document.hidden) {
      return;
    }

    let lineVersions = await this._contract.get_line_versions();
    let needLines = [];
    for (let i = 0; i < BoardHeight; ++i) {
      if (lineVersions[i] !== this._lineVersions[i]) {
        needLines.push(i);
      }
    }
    let requestLines = []
    for (let i = 0; i < needLines.length; i += NumLinesPerFetch) {
      requestLines.push(needLines.slice(i, i + NumLinesPerFetch));
    }

    let results = await Promise.all(requestLines.map(lines => this._contract.get_lines({lines})));
    results = results.flat();
    requestLines = requestLines.flat();
    for (let i = 0; i < requestLines.length; ++i) {
      let lineIndex = requestLines[i];
      let line = decodeLine(results[i]);
      this._lines[lineIndex] = line;
    }

    this._lineVersions = lineVersions;
    this._refreshOwners();
    this.renderCanvas();
  }

  _refreshOwners() {
    const counts = {};
    this._lines.flat().forEach((cell) => {
      counts[cell.ownerIndex] = (counts[cell.ownerIndex] || 0) + 1;
    })
    delete counts[0];
    const sortedKeys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    this.setState({
      owners: sortedKeys.map((accountIndex) => {
        accountIndex = parseInt(accountIndex);
        return {
          accountIndex,
          numPixels: counts[accountIndex],
        }
      })
    })
    sortedKeys.forEach(async (accountIndex) => {
      accountIndex = parseInt(accountIndex);
      if (!(accountIndex in this._accounts) || counts[accountIndex] !== (this._oldCounts[accountIndex] || 0)) {
        try {
          this._accounts[accountIndex] = await this.getAccountByIndex(accountIndex);
        } catch (err) {
          console.log("Failed to fetch account index #", accountIndex, err)
        }
        this.setState({
          accounts: Object.assign({}, this._accounts),
        })
      }
    })
    this.setState({
      accounts: Object.assign({}, this._accounts),
    })
    this._oldCounts = counts;
  }

  renderCanvas() {
    if (!this._context || !this._lines) {
      return;
    }

    const ctx = this._context;

    for (let i = 0; i < BoardHeight; ++i) {
      const line = this._lines[i];
      if (!line) {
        continue;
      }
      for (let j = 0; j < BoardWidth; ++j) {
        const p = line[j];
        ctx.fillStyle = intToColor(p.color);
        ctx.fillRect(j * CellWidth, i * CellHeight, CellWidth, CellHeight);
        if (this.state.highlightedAccountIndex >= 0) {
          if (p.ownerIndex !== this.state.highlightedAccountIndex) {
            ctx.fillStyle = 'rgba(32, 32, 32, 0.8)';
            ctx.fillRect(j * CellWidth, i * CellHeight, CellWidth / 2, CellHeight / 2);
            ctx.fillRect((j + 0.5) * CellWidth, (i + 0.5) * CellHeight, CellWidth/ 2, CellHeight/ 2);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(j * CellWidth, (i + 0.5) * CellHeight, CellWidth / 2, CellHeight / 2);
            ctx.fillRect((j + 0.5) * CellWidth, i * CellHeight, CellWidth/ 2, CellHeight/ 2);
          } else {
            ctx.beginPath();
            ctx.strokeStyle = ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 0.5;
            ctx.rect(j * CellWidth + 0.5, i * CellHeight + 0.5, CellWidth - 1, CellHeight - 1);
            ctx.stroke();
            ctx.closePath();
          }
        }
      }
    }

    this._pendingPixels.concat(this._queue).forEach((p) => {
      ctx.fillStyle = intToColor(p.color);
      ctx.fillRect(p.x * CellWidth, p.y * CellHeight, CellWidth, CellHeight);
    })

    if (this.state.selectedCell) {
      const c = this.state.selectedCell;
      if (this.state.pickingColor) {
        const color = this._lines[c.y] ? this._lines[c.y][c.x].color : 0;
        ctx.beginPath();
        ctx.strokeStyle = ctx.fillStyle = transparentColor(color, 0.5);
        ctx.lineWidth = CellWidth * 4;
        ctx.arc((c.x + 0.5) * CellWidth, (c.y + 0.5) * CellHeight, CellWidth * 4, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.closePath();

        ctx.beginPath();
        ctx.strokeStyle = ctx.fillStyle = transparentColor(color, 1);
        ctx.lineWidth = CellWidth * 2;
        ctx.arc((c.x + 0.5) * CellWidth, (c.y + 0.5) * CellHeight, CellWidth * 4, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.closePath();
      } else {
        ctx.fillStyle = transparentColor(this.state.currentColor, 0.2);
        ctx.fillRect(c.x * CellWidth, 0, CellWidth, c.y * CellHeight);
        ctx.fillRect(c.x * CellWidth, (c.y+ 1) * CellHeight, CellWidth, (BoardHeight - c.y - 1) * CellHeight);
        ctx.fillRect(0, c.y * CellHeight, c.x * CellWidth, CellHeight);
        ctx.fillRect( (c.x + 1) * CellWidth, c.y * CellHeight, (BoardWidth - c.x - 1) * CellWidth, CellHeight);

        ctx.beginPath();
        ctx.lineWidth = 3;
        ctx.fillStyle = intToColor(this.state.currentColor);
        ctx.strokeStyle = intToColor(this.state.currentColor);
        ctx.rect(c.x * CellWidth, c.y * CellHeight, CellWidth, CellHeight);
        ctx.stroke();
        ctx.closePath();
      }
    }

    if (!this.state.boardLoaded) {
      this.setState({
        boardLoaded: true
      })
    }
  }

  async requestSignIn() {
    const appTitle = 'Berry Club';
    await this._walletConnection.requestSignIn(
        NearConfig.contractName,
        appTitle
    )
  }

  async logOut() {
    this._walletConnection.signOut();
    this._accountId = null;
    this.setState({
      signedIn: !!this._accountId,
      accountId: this._accountId,
    })
  }

  hueColorChange(c) {
    console.log(c)
    this.setState({
      gammaColors: generateGamma(c.hsl.h)
    })
    this.changeColor(c)
  }

  saveColor() {
    const newColor = intToColor(this.state.currentColor);
    const index = this.state.colors.indexOf(newColor);
    if (index >= 0) {
      this.state.colors.splice(index, 1);
    }
    this.setState({
      colors: [newColor].concat(this.state.colors).slice(0, MaxNumColors)
    });
  }

  changeColor(c) {
    const currentColor = c.rgb.r * 0x010000 + c.rgb.g * 0x000100 + c.rgb.b;
    this.setState({
      pickerColor: c,
      currentColor,
    }, () => {
      this.renderCanvas();
    })
  }

  async buyTokens(amount) {
    const requiredBalance = PixelPrice.muln(amount);
    await this._contract.buy_tokens({}, new BN("30000000000000"), requiredBalance);
  }

  setHover(accountIndex, v) {
    if (v) {
      this.setState({
        highlightedAccountIndex: accountIndex,
      }, () => {
        this.renderCanvas();
      })
    } else if (this.state.highlightedAccountIndex === accountIndex) {
      this.setState({
        highlightedAccountIndex: -1,
      }, () => {
        this.renderCanvas();
      })
    }
  }

  async switchBerry(farmingBanana) {
    this.setState({
      farmingBanana,
    })
    await this._contract.select_farming_preference({
      berry: farmingBanana ? Berry.Banana : Berry.Avocado,
    });
    await this.refreshAccountStats();
  }

  render() {

    const content = !this.state.connected ? (
        <div>Connecting... <span className="spinner-grow spinner-grow-sm" role="status" aria-hidden="true"></span></div>
    ) : (this.state.signedIn ? (
        <div>
          <div className="float-right">
            <button
              className="btn btn-outline-secondary"
              onClick={() => this.logOut()}>Log out ({this.state.accountId})</button>
          </div>
          <div className="your-balance">
            Balance: <Balance
              account={this.state.account}
              pendingPixels={this.state.pendingPixels}
              detailed={true}
          />
          <div>
            Farming preference:
            <Switch
                onChange={(e) => this.switchBerry(e)}
                checked={this.state.farmingBanana}
                className="react-switch"
                height={30}
                width={70}
                offColor="#666"
                onColor="#666"
                uncheckedIcon={<div className="switch-berry avocado">{Avocado}</div>}
                checkedIcon={<div className="switch-berry banana">{Banana}</div>}
            />
          </div>
          </div>
          <div className="buttons">
            <button
              className="btn btn-primary"
              onClick={() => this.buyTokens(10)}>Buy <span className="font-weight-bold">25{Avocado}</span> for <span className="font-weight-bold">Ⓝ0.1</span></button>{' '}
            <button
              className="btn btn-primary"
              onClick={() => this.buyTokens(40)}>Buy <span className="font-weight-bold">100{Avocado}</span> for <span className="font-weight-bold">Ⓝ0.4</span></button>{' '}
            <button
              className="btn btn-primary"
              onClick={() => this.buyTokens(100)}>Buy <span className="font-weight-bold">250{Avocado}</span> for <span className="font-weight-bold">Ⓝ1</span></button>{' '}
            <button
              className="btn btn-success"
              onClick={() => this.buyTokens(500)}>DEAL: Buy <span className="font-weight-bold">1500{Avocado}</span> for <span className="font-weight-bold">Ⓝ5</span></button>
          </div>
          <div className="color-picker">
            <HuePicker color={ this.state.pickerColor } width="100%" disableAlpha={true} onChange={(c) => this.hueColorChange(c)}/>
            <GithubPicker className="circle-picker" colors={this.state.gammaColors} color={ this.state.pickerColor } triangle='hide' width="100%" onChangeComplete={(c) => this.changeColor(c)}/>
            <GithubPicker className="circle-picker" colors={this.state.colors} color={ this.state.pickerColor } triangle='hide' width="100%" onChangeComplete={(c) => this.hueColorChange(c)}/>
          </div>
        </div>
    ) : (
        <div style={{marginBottom: "10px"}}>
          <button
              className="btn btn-primary"
              onClick={() => this.requestSignIn()}>Log in with NEAR Wallet</button>
        </div>
    ));
    return (
        <div className="container">
          <div className="row">
            <div>
              <h2>{Avocado} Berry Club {Banana}</h2>
              {content}
              <div>
                {this.state.signedIn ? (<div>
                  Draw here - one {Avocado} per pixel. Hold <span className="badge badge-secondary">ALT</span> key to pick a color from board.{' '}
                  <button
                    className="btn btn-outline-secondary"
                    onClick={() => this.state.pickingColor ? this.disablePickColor() : this.enablePickColor() }>{ this.state.pickingColor ? 'Cancel' : 'Color Picker'}
                  </button>
                </div>) : ""}
                <canvas ref={this.canvasRef}
                        width={800}
                        height={800}
                        className={this.state.boardLoaded ? "pixel-board" : "pixel-board c-animated-background"}>

                </canvas>
              </div>
            </div>
            <div className="leaderboard">
              <h2>Leaderboard</h2>
              <div>
                <Leaderboard
                  owners={this.state.owners}
                  accounts={this.state.accounts}
                  setHover={(accountIndex, v) => this.setHover(accountIndex, v)}
                  selectedOwnerIndex={this.state.selectedOwnerIndex}
                  highlightedAccountIndex={this.state.highlightedAccountIndex}
                />
              </div>
            </div>
          </div>
        </div>
    );
  }
}

const Balance = (props) => {
  const account = props.account;
  if (!account) {
    return "";
  }
  const fraction = props.detailed ? 3: 1;
  const avacadoBalance = account.avocadoBalance - (props.pendingPixels || 0);
  const avocadoFarm = (account.avocadoPixels > 0) ? (
    <span>
      {'(+'}<span className="font-weight-bold">{account.avocadoPixels}</span>{Avocado}{'/day)'}
    </span>
  ) : "";
  const bananaFarm = (account.bananaPixels > 0) ? (
    <span>
      {'(+'}<span className="font-weight-bold">{account.bananaPixels}</span>{Banana}{'/day)'}
    </span>
  ) : "";
  return (
    <span className="balances font-small">
      <span className="font-weight-bold">{avacadoBalance.toFixed(fraction)}</span>{Avocado}{' '}
      <span className="font-weight-bold">{account.bananaBalance.toFixed(fraction)}</span>{Banana}{' '}
      {avocadoFarm}
      {bananaFarm}
      {
        props.pendingPixels ? <span> ({props.pendingPixels} pending)</span> : ""
      }
    </span>
  );
};

const Leaderboard = (props) => {
  const owners = props.owners.map((owner) => {
    if (owner.accountIndex in props.accounts) {
      owner.account = props.accounts[owner.accountIndex];
    }
    return <Owner
      key={owner.accountIndex}
      {...owner}
      isSelected={owner.accountIndex === props.selectedOwnerIndex}
      setHover={(v) => props.setHover(owner.accountIndex, v)}
      isHighlighted={owner.accountIndex === props.highlightedAccountIndex}
    />
  })
  return (
    <table className="table table-hover table-sm"><tbody>{owners}</tbody></table>
  );
};

const Owner = (props) => {
  const account = props.account;
  return (
    <tr onMouseEnter={() => props.setHover(true)}
        onMouseLeave={() => props.setHover(false)}
        className={props.isSelected ? "selected" : ""}>
      <td>
        {account ? <Account accountId={account.accountId} /> : "..."}
      </td>
      <td className="text-nowrap">
        <small>
          <Balance account={account} />
        </small>
      </td>
    </tr>
  )
}

const Account = (props) => {
  const accountId = props.accountId;
  const shortAccountId = (accountId.length > 6 + 6 + 3) ?
    (accountId.slice(0, 6) + '...' + accountId.slice(-6)) :
    accountId;
  return <a className="account"
            href={`https://wayback.berryclub.io/${accountId}`}>{shortAccountId}</a>
}

export default App;
