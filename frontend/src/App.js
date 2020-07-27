import "./App.css";
import React from 'react';
// import BN from 'bn.js';
import * as nearAPI from 'near-api-js'
import { HuePicker, GithubPicker } from 'react-color'

// const OneNear = new BN("1000000000000000000000000");
const ContractName = 'place.meta';
const BoardHeight = 50;
const BoardWidth = 50;
const NumLinesPerFetch = 10;
const ExpectedLineLength = 4 + 8 * BoardWidth;
const CellWidth = 16;
const CellHeight = 16;
const MaxNumColors = 31;

const intToColor = (c) => `#${c.toString(16).padStart(6, '0')}`;
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

    this.state = {
      connected: false,
      signedIn: false,
      accountId: null,
      balance: 0.0,
      numPixels: 0,
      boardLoaded: false,
      selectedCell: null,
      currentColor: 0xff0000,
      pickerColor: '#ff0000',
      colors: ["#000000", "#666666", "#aaaaaa", "#FFFFFF", "#F44E3B", "#D33115", "#9F0500", "#FE9200", "#E27300", "#C45100", "#FCDC00", "#FCC400", "#FB9E00", "#DBDF00", "#B0BC00", "#808900", "#A4DD00", "#68BC00", "#194D33", "#68CCCA", "#16A5A5", "#0C797D", "#73D8FF", "#009CE0", "#0062B1", "#AEA1FF", "#7B64FF", "#653294", "#FDA1FF", "#FA28FF", "#AB149E"],
      gammaColors: generateGamma(0),
    };

    this._balanceRefreshTimer = null;
    this.canvasRef = React.createRef();
    this._context = false;
    this._lines = false;

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
      const x = Math.trunc(e.offsetX / CellWidth);
      const y = Math.trunc(e.offsetY / CellHeight);
      let cell = null;
      if (x >= 0 && x < BoardWidth && y >= 0 && y < BoardHeight) {
        cell = { x, y };
      }
      if (JSON.stringify(cell) !== JSON.stringify(this.state.selectedCell)) {
        this.setState({
          selectedCell: cell,
        }, () => {
          this.renderCanvas()
        })
      }
    });

    canvas.addEventListener('click', async (e) => {
      if (this.state.selectedCell !== null) {
        this.saveColor();
        await this.drawPixel(this.state.selectedCell);
      }
    });
  }

  async drawPixel(cell) {
    if (!this.state.signedIn || !this._lines || !this._lines[cell.y]) {
      return;
    }

    const oldPixel = this._lines[cell.y][cell.x];

    if (oldPixel.color !== this.state.currentColor) {
      oldPixel.pending = true
      await this._contract.draw({
        pixels: [{
          x: cell.x,
          y: cell.y,
          color: this.state.currentColor,
        }]
      });
      await Promise.all([this.refreshBoard(), this.refreshAccountStats()]);
    }
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
      numPixels,
    });

    this._balanceRefreshTimer = setInterval(() => {
      const t = new Date().getTime();
      this.setState({
        balance: (balance + (t - startTime) * rewardPerMs) / this._pixelCost
      })
    }, 100);
  }

  async _initNear() {
    const nearConfig = {
      networkId: 'default',
      nodeUrl: 'https://rpc.nearprotocol.com',
      contractName: ContractName,
      walletUrl: 'https://wallet.nearprotocol.com',
    };
    const keyStore = new nearAPI.keyStores.BrowserLocalStorageKeyStore();
    const near = await nearAPI.connect(Object.assign({ deps: { keyStore } }, nearConfig));
    this._keyStore = keyStore;
    this._nearConfig = nearConfig;
    this._near = near;

    this._walletConnection = new nearAPI.WalletConnection(near, ContractName);
    this._accountId = this._walletConnection.getAccountId();

    this._account = this._walletConnection.account();
    this._contract = new nearAPI.Contract(this._account, ContractName, {
      viewMethods: ['get_lines', 'get_line_versions', 'get_pixel_cost', 'get_account_balance', 'get_account_num_pixels', 'get_account_id_by_index'],
      changeMethods: ['draw', 'buy_tokens'],
    });
    this._pixelCost = parseFloat(await this._contract.get_pixel_cost());
    if (this._accountId) {
      await this.refreshAccountStats();
    }
    this._lineVersions = Array(BoardHeight).fill(-1);
    this._lines = Array(BoardHeight).fill(false);
    await this.refreshBoard();
  }

  async refreshBoard() {
    let lineVersions = await this._contract.get_line_versions();
    let needLines = [];
    for (let i = 0; i < BoardHeight; ++i) {
      if (lineVersions[i] !== this._lineVersions) {
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
    this.renderCanvas();
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
      }
    }

    if (this.state.selectedCell) {
      const c = this.state.selectedCell;
      ctx.beginPath();
      ctx.strokeStyle = intToColor(this.state.currentColor);
      ctx.rect(c.x * CellWidth, c.y * CellHeight, CellWidth, CellHeight);
      ctx.stroke();
      ctx.closePath();
    }

    if (!this.state.boardLoaded) {
      this.setState({
        boardLoaded: true
      })
    }
  }

  async requestSignIn() {
    const appTitle = 'NEAR Place';
    await this._walletConnection.requestSignIn(
        ContractName,
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
    if (this.state.colors.indexOf(newColor) === -1) {
      this.setState({
        colors: [newColor].concat(this.state.colors).slice(0, MaxNumColors)
      });
    }
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

  render() {
    const content = !this.state.connected ? (
        <div>Connecting... <span className="spinner-grow spinner-grow-sm" role="status" aria-hidden="true"></span></div>
    ) : (this.state.signedIn ? (
        <div>
          <div className="float-right">
            <button
              className="btn btn-outline-secondary"
              onClick={() => this.logOut()}>Log out</button>
          </div>
          <h4>Hello, <span className="font-weight-bold">{this.state.accountId}</span>!</h4>
          <div>
            PIXEL tokens: {this.state.balance.toFixed(6)}
          </div>
          <div>
            Your pixels: {this.state.numPixels}
          </div>
          <div className="color-picker">
            <HuePicker color={ this.state.pickerColor } width="100%" disableAlpha={true} onChange={(c) => this.hueColorChange(c)}/>
            <GithubPicker className="circle-picker" colors={this.state.gammaColors} color={ this.state.pickerColor } triangle='hide' width="100%" onChangeComplete={(c) => this.changeColor(c)}/>
            <GithubPicker className="circle-picker" colors={this.state.colors} color={ this.state.pickerColor } triangle='hide' width="100%" onChangeComplete={(c) => this.hueColorChange(c)}/>
          </div>
        </div>
    ) : (
        <div>
          <button
              className="btn btn-primary"
              onClick={() => this.requestSignIn()}>Log in with NEAR Wallet</button>
        </div>
    ));
    return (
      <div className="px-5">
        <h1>NEAR Place</h1>
        {content}
        <div>
          <canvas ref={this.canvasRef}
                  width={800}
                  height={800}
                  className={this.state.boardLoaded ? "pixel-board" : "pixel-board c-animated-background"}>

          </canvas>
        </div>
      </div>
    );
  }
}

export default App;
