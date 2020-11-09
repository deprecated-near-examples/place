import "./App.css";
import React from 'react';
import BN from 'bn.js';
import * as nearAPI from 'near-api-js'
import { HuePicker, GithubPicker } from 'react-color'

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
      balance: 0.0,
      numPixels: 0,
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
    };

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

    canvas.addEventListener('mousemove', (e) => {
      const x = Math.trunc(e.offsetX / e.target.clientWidth * BoardWidth);
      const y = Math.trunc(e.offsetY / e.target.clientHeight * BoardWidth);
      let cell = null;
      if (x >= 0 && x < BoardWidth && y >= 0 && y < BoardHeight) {
        cell = { x, y };
      }
      if (JSON.stringify(cell) !== JSON.stringify(this.state.selectedCell)) {
        this.setState({
          selectedCell: cell,
        }, async () => {
          this.renderCanvas()
          if (this.state.selectedCell !== null && (e.buttons & 1) > 0) {
            if (this.state.pickingColor) {
              this.pickColor(this.state.selectedCell);
            } else {
              this.saveColor();
              await this.drawPixel(this.state.selectedCell);
            }
          }
        })
      }
    });

    canvas.addEventListener('mousedown', async (e) => {
      if (this.state.selectedCell !== null) {
        if (this.state.pickingColor) {
          this.pickColor(this.state.selectedCell);
        } else {
          this.saveColor();
          await this.drawPixel(this.state.selectedCell);
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      e.altKey && this.setState({
        pickingColor: true,
      }, () => {
        this.renderCanvas()
      });
    })
    document.addEventListener('keyup', (e) => {
      !e.altKey && this.setState({
        pickingColor: false,
      }, () => {
        this.renderCanvas()
      });
    })
  }

  pickColor(cell) {
    if (!this.state.signedIn || !this._lines || !this._lines[cell.y]) {
      return;
    }
    const color = this._lines[cell.y][cell.x].color;

    this.setState({
      currentColor: color,
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
    if (this.state.balance - this.state.pendingPixels < 1) {
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

  async refreshAccountStats() {
    let balance = parseFloat(await this._contract.get_account_balance({account_id: this._accountId}));
    let numPixels = await this._contract.get_account_num_pixels({account_id: this._accountId})
    if (this._balanceRefreshTimer) {
      clearInterval(this._balanceRefreshTimer);
      this._balanceRefreshTimer = null;
    }
    const startTime = new Date().getTime();
    const rewardPerMs = (numPixels + 1) * this._pixelCost / (24 * 60 * 60 * 1000);

    this.setState({
      balance: balance / this._pixelCost,
      pendingPixels: this._queue.length,
      numPixels,
    });

    this._balanceRefreshTimer = setInterval(() => {
      const t = new Date().getTime();
      this.setState({
        balance: (balance + (t - startTime) * rewardPerMs) / this._pixelCost,
        pendingPixels: this._pendingPixels.length + this._queue.length,
      })
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
      viewMethods: ['get_lines', 'get_line_versions', 'get_pixel_cost', 'get_account_balance', 'get_account_num_pixels', 'get_account_id_by_index'],
      changeMethods: ['draw', 'buy_tokens'],
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
          const accountId = await this._contract.get_account_id_by_index({account_index: accountIndex});
          const accountBalance = await this._contract.get_account_balance({account_id: accountId});
          const balance = parseFloat(accountBalance) / this._pixelCost;
          this._accounts[accountIndex] = {
            accountIndex,
            accountId,
            balance,
          };
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
        if (this.state.highlightedAccountIndex >= 0 && p.ownerIndex !== this.state.highlightedAccountIndex) {
          ctx.fillStyle = '#000';
          ctx.fillRect(j * CellWidth, i * CellHeight, CellWidth, CellHeight);
          ctx.fillStyle = transparentColor(p.color, 0.2);
          ctx.fillRect(j * CellWidth, i * CellHeight, CellWidth, CellHeight);
        } else {
          ctx.fillStyle = intToColor(p.color);
          ctx.fillRect(j * CellWidth, i * CellHeight, CellWidth, CellHeight);
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
              balance={this.state.balance - this.state.pendingPixels}
              numPixels={this.state.numPixels}
              pendingPixels={this.state.pendingPixels}
          />
          </div>
          <div className="buttons">
            <button
              className="btn btn-primary"
              onClick={() => this.buyTokens(10)}>Buy <span className="font-weight-bold">25🥑</span> for <span className="font-weight-bold">Ⓝ0.1</span></button>{' '}
            <button
              className="btn btn-primary"
              onClick={() => this.buyTokens(40)}>Buy <span className="font-weight-bold">100🥑</span> for <span className="font-weight-bold">Ⓝ0.4</span></button>{' '}
            <button
              className="btn btn-primary"
              onClick={() => this.buyTokens(100)}>Buy <span className="font-weight-bold">250🥑</span> for <span className="font-weight-bold">Ⓝ1</span></button>{' '}
            <button
              className="btn btn-success"
              onClick={() => this.buyTokens(500)}>DEAL: Buy <span className="font-weight-bold">1500🥑</span> for <span className="font-weight-bold">Ⓝ5</span></button>
          </div>
          <div className="color-picker">
            <div>Select a color to draw</div>
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
      <div className="px-5">
        <h1>🥑 Berry Club</h1>
        <div className="container">
          <div className="row">
            <div className="col-lg-8">
              {content}
              <div>
                {this.state.signedIn ? <div>Draw here - one 🥑 per pixel. Hold <span className="badge badge-secondary">ALT</span> key to pick a color from board.</div> : ""}
                <canvas ref={this.canvasRef}
                        width={800}
                        height={800}
                        className={this.state.boardLoaded ? "pixel-board" : "pixel-board c-animated-background"}>

                </canvas>
              </div>
            </div>
            <div className="col-lg-4">
              <div>Leaderboard</div>
              <div>
                <Leaderboard
                  owners={this.state.owners}
                  accounts={this.state.accounts}
                  setHover={(accountIndex, v) => this.setHover(accountIndex, v)}
                  highlightedAccountIndex={this.state.highlightedAccountIndex}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

const Balance = (props) => {
  return (
    <span className="balances font-small">
      <span className="font-weight-bold">{props.balance.toFixed(3)}</span>
      {'🥑 (+'}
      <span className="font-weight-bold">{props.numPixels + 1}</span>
      {'🥑/day)'}
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
        onMouseLeave={() => props.setHover(false)}>
      <td>
        {account ? <Account accountId={account.accountId} /> : "..."}
      </td>
      <td className="text-nowrap">
        <small>
          <Balance balance={account ? account.balance : 0} numPixels={props.numPixels} />
        </small>
      </td>
    </tr>
  )
}

const Account = (props) => {
  const accountId = props.accountId;
  let shortAccountId = accountId
  if (accountId.length > 6 + 6 + 3) {
    shortAccountId = accountId.slice(0, 6) + '...' + accountId.slice(-6);
  }
  return <a className="account"
            href={`https://explorer.near.org/accounts/${accountId}`}>{shortAccountId}</a>
}

export default App;
