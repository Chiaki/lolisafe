/* global lsKeys, page, swal */

// keys for localStorage
lsKeys.render = 'render'

page.renderType = 'miku'
page.renderConfig = {
  al: {
    name: 'ship waifu~',
    root: 'render/al/',
    array: [
      'admiral_graf_spee_1.png',
      'admiral_hipper_1.png',
      'akagi_1.png',
      'akashi_1.png',
      'akashi_2.png',
      'atago_1.png',
      'atago_3.png',
      'atago_4.png',
      'atago_5.png',
      'belfast_2.png',
      'choukai_1.png',
      'deutschland_1.png',
      'enterprise_1.png',
      'glorious_1.png',
      'hammann_1.png',
      'hammann_2.png',
      'hammann_3.png',
      'hatsuharu_1.png',
      'kaga_1.png',
      'kaga_2.png',
      'kaga_3.png',
      'laffey_1.png',
      'laffey_2.png',
      'laffey_3.png',
      'prinz_eugen_3.png',
      'san_diego_1.png',
      'takao_3.png',
      'unicorn_1.png',
      'unicorn_2.png',
      'unicorn_3.png',
      'unicorn_4.png',
      'unicorn_6.png',
      'unicorn_7.png',
      'unicorn_8.png',
      'yamashiro_1.png',
      'yamashiro_2.png',
      'yamashiro_3.png',
      'yukikaze_1.png'
    ]
  },
  miku: {
    name: 'miku ❤️~',
    root: 'render/miku/',
    array: []
  }
}

// miku: Generate an array of file names from 001.png to 050.png
for (let i = 1; i <= 50; i++)
  page.renderConfig.miku.array.push(`${('00' + i).slice(-3)}.png`)

page.config = null
page.render = null

page.doRenderSwal = () => {
  const div = document.createElement('div')
  div.innerHTML = `
    <div class="field">
      <div class="control">
        <label class="checkbox">
          <input id="swalRender" type="checkbox" ${localStorage[lsKeys.render] === '0' ? '' : 'checked'}>
          Enable random render of ${page.config.name}
        </label>
      </div>
      <p class="help">If disabled, you will still be able to see a small button on the bottom right corner of the screen to re-enable it.</p>
    </div>
  `

  swal({
    content: div,
    buttons: {
      confirm: true
    }
  }).then(value => {
    if (!value) return
    const newValue = div.querySelector('#swalRender').checked ? undefined : '0'
    if (newValue !== localStorage[lsKeys.render]) {
      if (newValue)
        localStorage[lsKeys.render] = newValue
      else
        localStorage.removeItem(lsKeys.render)
      swal('', `Random render is now ${newValue ? 'disabled' : 'enabled'}.`, 'success', {
        buttons: false,
        timer: 1500
      })
      const element = document.querySelector('body > .render')
      element.remove()
      page.doRender()
    }
  })
}

page.getRenderVersion = () => {
  const renderScript = document.querySelector('#renderScript')
  if (renderScript && renderScript.dataset.version)
    return `?v=${renderScript.dataset.version}`
  return ''
}

page.doRender = () => {
  page.config = page.renderConfig[page.renderType]
  if (!page.config || !page.config.array.length) return

  let element
  if (localStorage[lsKeys.render] === '0') {
    element = document.createElement('a')
    element.className = 'button is-info is-hidden-mobile'
    element.title = page.config.name
    element.innerHTML = '<i class="icon-picture"></i>'
  } else {
    // Let us just allow people to get new render when toggling the option
    page.render = page.config.array[Math.floor(Math.random() * page.config.array.length)]
    element = document.createElement('img')
    element.alt = element.title = page.config.name
    element.className = 'is-hidden-mobile'
    element.src = `${page.config.root}${page.render}${page.getRenderVersion()}`
  }

  element.classList.add('render')
  element.addEventListener('click', page.doRenderSwal)
  document.body.appendChild(element)
}
