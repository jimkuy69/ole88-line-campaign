(() => {
  const section = document.createElement('section');
  section.className = 'hotspot-planner';
  section.innerHTML = '<h3>Image hotspot planner · design and export</h3><p class="hint">Add up to four HTTPS images, choose an existing enabled button or activity, then drag a rectangle over its touch area. These saved coordinates are a design plan only; the current LINE message renderer does not send image hotspots.</p><div class="hotspot-controls"></div><div class="hotspot-maps"></div>';
  $('heroPreview').after(section);

  const controls = section.querySelector('.hotspot-controls');
  const mapsBox = section.querySelector('.hotspot-maps');
  const addMapButton = el('button', { type: 'button', className: 'secondary' }, 'Add image to map');
  const exportButton = el('button', { type: 'button', className: 'secondary' }, 'Export hotspot plan JSON');
  controls.append(addMapButton, exportButton);

  const initialMaps = () => {
    const stored = state?.campaign.settings?.imageHotspots;
    if (Array.isArray(stored)) return stored.map(map => ({
      imageUrl: typeof map?.imageUrl === 'string' ? map.imageUrl : '',
      hotspots: Array.isArray(map?.hotspots) ? map.hotspots.map(hotspot => ({ ...hotspot })) : []
    }));
    const urls = [state?.campaign.heroImage, state?.campaign.settings?.secondaryImage]
      .filter(url => typeof url === 'string' && url.trim());
    return [...new Set(urls)].slice(0, 4).map(imageUrl => ({ imageUrl, hotspots: [] }));
  };

  let maps = [];
  let selectedTarget = '';
  let drawing = false;

  const availableTargets = () => [
    ...state.buttons.filter(item => item.enabled).map(item => ({
      type: 'button', key: item.buttonKey, label: item.label, actionType: item.actionType, actionValue: item.actionValue
    })),
    ...state.activities.filter(item => item.enabled).map(item => ({
      type: 'activity', key: item.activityKey, label: item.title, actionType: item.actionType, actionValue: item.actionValue
    }))
  ];

  const targetValue = target => `${target.type}:${target.key}`;
  const readTarget = value => availableTargets().find(target => targetValue(target) === value);
  const selectedTargetEntry = () => readTarget(selectedTarget) || availableTargets()[0];

  function saveMaps() {
    state.campaign.settings = {
      ...state.campaign.settings,
      imageHotspots: maps
        .filter(map => map.imageUrl.trim() || map.hotspots.length)
        .map(map => ({ imageUrl: map.imageUrl.trim(), hotspots: map.hotspots }))
    };
  }

  function render() {
    if (!state) return;
    mapsBox.replaceChildren();
    const targets = availableTargets();
    if (!selectedTarget || !readTarget(selectedTarget)) selectedTarget = targets[0] ? targetValue(targets[0]) : '';

    maps.forEach((map, mapIndex) => {
      const card = el('article', { className: 'hotspot-map' });
      const header = el('div', { className: 'hotspot-map-header' });
      const urlLabel = el('label', {}, `Image ${mapIndex + 1} HTTPS URL`);
      const urlInput = el('input', { type: 'url', placeholder: 'https://example.org/image.png' });
      urlInput.value = map.imageUrl;
      urlInput.onchange = () => { map.imageUrl = urlInput.value.trim(); saveMaps(); render(); };
      urlLabel.append(urlInput);
      const removeMap = el('button', { type: 'button', className: 'danger' }, 'Remove image');
      removeMap.onclick = () => { maps.splice(mapIndex, 1); saveMaps(); render(); };
      header.append(urlLabel, removeMap);
      const targetPicker = el('label', {}, 'Bind new area to');
      const targetSelect = el('select');
      if (!targets.length) targetSelect.append(el('option', { value: '' }, 'Enable a button or activity first'));
      for (const target of targets) {
        const value = targetValue(target);
        targetSelect.append(el('option', { value }, `${target.type.toUpperCase()} · ${target.key} · ${target.label || '(no label)'}`));
      }
      targetSelect.value = selectedTarget;
      targetSelect.onchange = () => { selectedTarget = targetSelect.value; };
      targetPicker.append(targetSelect);
      card.append(header, targetPicker);

      const canvas = el('div', { className: 'hotspot-canvas' });
      if (map.imageUrl) {
        const frame = el('div', { className: `hotspot-frame${drawing ? ' is-drawing' : ''}` });
        const image = el('img', { src: map.imageUrl, alt: `Image ${mapIndex + 1} hotspot canvas` });
        image.draggable = false;
        image.onerror = () => canvas.replaceChildren(el('p', { className: 'error' }, 'Image could not be loaded. Check that its HTTPS URL is publicly reachable.'));
        frame.append(image);
        for (const hotspot of map.hotspots) {
          const target = hotspot.targetType === 'button'
            ? state.buttons.find(item => item.buttonKey === hotspot.targetKey)
            : state.activities.find(item => item.activityKey === hotspot.targetKey);
          const overlay = el('div', { className: 'hotspot-area' });
          Object.assign(overlay.style, {
            left: `${hotspot.x / 10}%`, top: `${hotspot.y / 10}%`,
            width: `${hotspot.width / 10}%`, height: `${hotspot.height / 10}%`
          });
          overlay.append(el('span', {}, `${hotspot.targetType}:${hotspot.targetKey}${target?.label ? ` · ${target.label}` : ''}`));
          frame.append(overlay);
        }
        if (drawing && targets.length) {
          let start = null;
          let draftArea = null;
          frame.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            const rect = frame.getBoundingClientRect();
            start = { x: event.clientX, y: event.clientY, rect };
            frame.setPointerCapture(event.pointerId);
            draftArea = el('div', { className: 'hotspot-area is-pending' });
            frame.append(draftArea);
            event.preventDefault();
          });
          frame.addEventListener('pointermove', event => {
            if (!start || !draftArea) return;
            const left = Math.max(0, Math.min(start.x, event.clientX) - start.rect.left);
            const top = Math.max(0, Math.min(start.y, event.clientY) - start.rect.top);
            const right = Math.min(start.rect.width, Math.max(start.x, event.clientX) - start.rect.left);
            const bottom = Math.min(start.rect.height, Math.max(start.y, event.clientY) - start.rect.top);
            Object.assign(draftArea.style, {
              left: `${100 * left / start.rect.width}%`, top: `${100 * top / start.rect.height}%`,
              width: `${100 * (right - left) / start.rect.width}%`, height: `${100 * (bottom - top) / start.rect.height}%`
            });
          });
          frame.addEventListener('pointerup', event => {
            if (!start) return;
            const rect = start.rect;
            const x1 = Math.max(0, Math.min(rect.width, start.x - rect.left));
            const y1 = Math.max(0, Math.min(rect.height, start.y - rect.top));
            const x2 = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
            const y2 = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
            const left = Math.min(x1, x2), top = Math.min(y1, y2);
            const width = Math.abs(x2 - x1), height = Math.abs(y2 - y1);
            start = null;
            if (draftArea) draftArea.remove();
            draftArea = null;
            if (width < rect.width * 0.008 || height < rect.height * 0.008) return;
            const target = selectedTargetEntry();
            if (!target) return;
            const x = Math.min(999, Math.round(1000 * left / rect.width));
            const y = Math.min(999, Math.round(1000 * top / rect.height));
            map.hotspots.push({
              targetType: target.type, targetKey: target.key,
              x, y,
              width: Math.max(1, Math.min(1000 - x, Math.round(1000 * width / rect.width))),
              height: Math.max(1, Math.min(1000 - y, Math.round(1000 * height / rect.height)))
            });
            saveMaps();
            render();
          });
        }
        canvas.append(frame);
      } else {
        canvas.append(el('p', { className: 'hint' }, 'Enter a public HTTPS image URL to display it here.'));
      }
      const drawButton = el('button', { type: 'button', className: drawing ? '' : 'secondary' },
        drawing ? 'Drawing enabled · drag on image' : 'Draw hotspot area');
      drawButton.disabled = !targets.length || !map.imageUrl;
      drawButton.onclick = () => { drawing = !drawing; render(); };
      const areaList = el('ol', { className: 'hotspot-area-list' });
      map.hotspots.forEach((hotspot, areaIndex) => {
        const row = el('li');
        const choose = el('select');
        for (const target of targets) {
          const value = targetValue(target);
          choose.append(el('option', { value }, `${target.type.toUpperCase()} · ${target.key} · ${target.label || '(no label)'}`));
        }
        choose.value = `${hotspot.targetType}:${hotspot.targetKey}`;
        choose.onchange = () => {
          const target = readTarget(choose.value);
          if (target) { hotspot.targetType = target.type; hotspot.targetKey = target.key; saveMaps(); render(); }
        };
        const coordinates = el('span', {}, `x ${hotspot.x}, y ${hotspot.y}, w ${hotspot.width}, h ${hotspot.height} / 1000`);
        const remove = el('button', { type: 'button', className: 'danger' }, 'Delete area');
        remove.onclick = () => { map.hotspots.splice(areaIndex, 1); saveMaps(); render(); };
        row.append(choose, coordinates, remove);
        areaList.append(row);
      });
      card.append(canvas, drawButton, areaList);
      mapsBox.append(card);
    });
  }

  addMapButton.onclick = () => {
    if (maps.length >= 4) return;
    maps.push({ imageUrl: '', hotspots: [] });
    render();
  };
  exportButton.onclick = () => {
    if (!state) return;
    const draft = collect();
    const currentMaps = draft.campaign.settings.imageHotspots || [];
    const targets = [
      ...draft.buttons.map(item => ({ type: 'button', key: item.buttonKey, label: item.label, actionType: item.actionType, actionValue: item.actionValue })),
      ...draft.activities.map(item => ({ type: 'activity', key: item.activityKey, label: item.title, actionType: item.actionType, actionValue: item.actionValue }))
    ];
    const plan = {
      format: 'ole88-image-hotspot-plan/v1',
      campaign: { code: draft.campaign.code, title: draft.campaign.title },
      images: currentMaps.map(map => ({
        imageUrl: map.imageUrl,
        hotspots: map.hotspots.map(hotspot => ({
          area: { x: hotspot.x, y: hotspot.y, width: hotspot.width, height: hotspot.height, coordinateScale: 1000 },
          target: targets.find(target => target.type === hotspot.targetType && target.key === hotspot.targetKey)
            || { type: hotspot.targetType, key: hotspot.targetKey }
        }))
      }))
    };
    const link = document.createElement('a');
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }));
    link.href = url;
    link.download = `${draft.campaign.code || 'campaign'}-image-hotspots.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const fillBase = fill;
  fill = () => {
    fillBase();
    maps = initialMaps();
    saveMaps();
    render();
  };

  const collectBase = collect;
  collect = () => {
    const draft = collectBase();
    draft.campaign.settings = {
      ...draft.campaign.settings,
      imageHotspots: maps
        .filter(map => map.imageUrl.trim() || map.hotspots.length)
        .map(map => ({ imageUrl: map.imageUrl.trim(), hotspots: map.hotspots }))
    };
    return draft;
  };
})();
