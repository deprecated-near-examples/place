import "./Weapons.scss";
import React from 'react';
import Files from "react-files";

const Avocado = <span role="img" aria-label="avocado" className="berry">🥑</span>;

export class Weapons extends React.Component {
  constructor(props) {
    super(props);
    this.canvasRef = React.createRef();
    this.state = {
      width: 48,
      height: 28,
      avocadoNeeded: 100,
      lockedAspect: true,
    };
  }

  componentDidMount() {
    this.canvas = this.canvasRef.current;
    this.ctx = this.canvas.getContext('2d');
    this.sourceImage = new Image();
    this.sourceImage.onload = () => {
      this.draw();
    }
    this.sourceImage.src = "/bfg.png";
  }

  draw() {
    const sourceImage = this.sourceImage;
    const canvas = this.canvas;
    const ctx = this.ctx;
    const width = this.state.width;
    const height = this.state.height;

    // Create a canvas with the desired dimensions
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = (width * 10) + 'px';
    canvas.style.height = (height * 10) + 'px';

    // Scale and draw the source image to the canvas
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "low";
    ctx.drawImage(sourceImage, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    this.imageData = imageData;
    this.setState({
      avocadoNeeded: new Uint32Array(imageData.data.buffer).reduce((sum, v) => sum + (v ? 1 : 0), 0),
    });
  }

  async onFilesChange(f) {
    const sourceImage = this.sourceImage;
    let reader = new FileReader();

    reader.readAsDataURL(f[0]);

    sourceImage.onload = () => {
      let width = sourceImage.naturalWidth;
      let height = sourceImage.naturalHeight;
      if (sourceImage.naturalWidth > 50 || sourceImage.naturalHeight > 50) {
        const aspect = width / height;
        width = Math.round(20 * Math.min(1, aspect));
        height = Math.round(20 * Math.min(1, 1 / aspect));
      }
      this.setState({
        width: Math.min(50, Math.max(1, width)),
        height: Math.min(50, Math.max(1, height)),
      });
      this.draw();

    }

    reader.onload = function(event) {
      sourceImage.src = event.target.result;
    };
  }

  async onFilesError(e, f) {
    console.log(e, f);
  }

  updateVal(key, value) {
    value = Math.min(50, Math.max(1, value));
    if (this.state.lockedAspect) {
      const aspect = this.sourceImage.naturalWidth / this.sourceImage.naturalHeight;
      let width, height;
      if (key === 'width') {
        width = value;
        height = Math.round(width / aspect);
      } else {
        height = value;
        width = Math.round(height * aspect);
      }
      this.setState({
        width: Math.min(50, Math.max(1, width)),
        height: Math.min(50, Math.max(1, height)),
      }, () => {
        this.draw();
      });
    } else {
      this.setState({
        [key]: value,
      }, () => {
        this.draw();
      })
    }
  }

  changeLockedAspect() {
    this.setState({
      lockedAspect: !this.state.lockedAspect,
    })
  }

  render() {
    return (
      <div className="weapons-popup">
        <div className="weapons-content">
          <h2>So you need a BFG?</h2>
          <div>
            <Files
              type="button"
              className='btn'
              onChange={(f) => this.onFilesChange(f)}
              onError={(e, f) => this.onFilesError(e, f)}
              multiple={false}
              accepts={['image/*']}
              minFileSize={1}
              clickable
            >
              Click to upload an image
            </Files>
          </div>
          <div>
            <label>Width</label>
            <input type="number" value={this.state.width}
                   min={1}
                   max={50}
                   onChange={(e) => this.updateVal('width', e.target.value)} />
            {' '}
            <button
              className={"btn btn-outline-secondary low-right-margin" + (this.state.lockedAspect ? " btn-pressed" : " btn-not-pressed")}
              onClick={() => this.changeLockedAspect()}
            >
              <span role="img" aria-label="link" className="berry">🔗</span>
            </button>
            <label>Height</label>
            <input type="number" value={this.state.height}
                   min={1}
                   max={50}
                   onChange={(e) => this.updateVal('height', e.target.value)} />
          </div>
          <button
            className='btn btn-success btn-large'
            disabled={!this.props.account || this.props.account.avocadoBalance < this.state.avocadoNeeded}
            onClick={() => this.props.renderIt(this.imageData, this.state.avocadoNeeded)}
          >
            Render on the board using {this.state.avocadoNeeded} {Avocado}
          </button>
          <div className="canvas-wrapper">
            <canvas ref={this.canvasRef}
                    width={480}
                    height={280}
                    className="draw-preview">
            </canvas>
          </div>

        </div>
      </div>
    )
  }
}

