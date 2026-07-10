import createPlotlyComponent from 'react-plotly.js/factory'
import Plotly from 'plotly.js-dist-min'

// Use the declared renderer. The default react-plotly entry requires an
// undeclared plotly.js peer and fails after a clean install.
export default createPlotlyComponent(Plotly)
