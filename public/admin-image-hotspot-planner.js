(() => {
  const section = document.createElement('section');
  section.className = 'hotspot-planner';
  section.innerHTML = '<h3>Campaign image plan · internal handoff only</h3><p class="hint">1. Add up to four original JPEG/PNG images. 2. Choose an enabled button or activity. 3. Draw, select, move, or resize its touch area. 4. Resolve every red blocker before export. This creates a design handoff only; it does not create a LINE Imagemap, publish a campaign, or send a LINE message.</p><div class="hotspot-controls"></div><div class="hotspot-maps"></div><div class="hotspot-validation" aria-live="polite"></div><div class="hotspot-export-result hidden"><label>Thai AI handoff prompt<textarea class="hotspot-prompt" readonly></textarea></label><button type="button" class="secondary hotspot-copy-prompt">Copy prompt</button></div>';
  $('heroPreview').after(section);

  const controls = section.querySelector('.hotspot-controls');
  const mapsBox = section.querySelector('.hotspot-maps');
  const validationBox = section.querySelector('.hotspot-validation');
  const exportResult = section.querySelector('.hotspot-export-result');
  const promptText = section.querySelector('.hotspot-prompt');
  controls.before(el('p', { className: 'hint' }, 'Keyboard: focus a touch area and use arrow keys to move it; Shift + arrow keys resize it.'));
  const invalidateExport = () => exportResult.classList.add('hidden');
  $('editor').addEventListener('input', invalidateExport);
  $('editor').addEventListener('change', invalidateExport);
  const addMapButton = el('button', { type: 'button', className: 'secondary' }, '1 · Add image');
  const orphanButton = el('button', { type: 'button', className: 'secondary' }, 'Check unreferenced uploads (dry-run)');
  const exportButton = el('button', { type: 'button', className: 'secondary' }, '4 · Validate and export handoff');
  controls.append(addMapButton, orphanButton, exportButton);

  const copyMap = map => ({
    imageUrl: typeof map?.imageUrl === 'string' ? map.imageUrl : '',
    ...(typeof map?.assetId === 'string' ? { assetId: map.assetId } : {}),
    ...(map?.metadata && typeof map.metadata === 'object' ? { metadata: { ...map.metadata } } : {}),
    hotspots: Array.isArray(map?.hotspots)
      ? map.hotspots.map(hotspot => ({ ...hotspot, id: hotspot.id || crypto.randomUUID() }))
      : []
  });
  const initialMaps = () => {
    const stored = state?.campaign.settings?.imageHotspots;
    if (Array.isArray(stored)) return stored.map(copyMap);
    if (stored && typeof stored === 'object' && !Array.isArray(stored) && 'imageUrl' in stored) {
      return [copyMap(stored)];
    }
    const urls = [state?.campaign.heroImage, state?.campaign.settings?.secondaryImage]
      .filter(url => typeof url === 'string' && url.trim());
    return [...new Set(urls)].slice(0, 4).map(imageUrl => ({ imageUrl, hotspots: [] }));
  };

  let maps = [];
  let selectedTarget = '';
  let drawingMap = -1;
  let selectedAreas = new Map();

  const availableTargets = () => [
    ...state.buttons.filter(item => item.enabled).map(item => ({
      type: 'button', key: item.buttonKey, label: item.label, actionType: item.actionType, actionValue: item.actionValue
    })),
    ...state.activities.filter(item => item.enabled).map(item => ({
      type: 'activity', key: item.activityKey, label: item.title, actionType: item.actionType, actionValue: item.actionValue
    }))
  ];
  const targetValue = target => `${target.type ?? target.targetType}:${target.key ?? target.targetKey}`;
  const readTarget = value => availableTargets().find(target => targetValue(target) === value);
  const selectedTargetEntry = () => readTarget(selectedTarget) || availableTargets()[0];
  const targetFromHotspot = hotspot => hotspot.targetType === 'button'
    ? state.buttons.find(item => item.buttonKey === hotspot.targetKey)
    : state.activities.find(item => item.activityKey === hotspot.targetKey);

  function saveMaps() {
    state.campaign.settings = {
      ...state.campaign.settings,
      imageHotspots: maps
        .filter(map => map.imageUrl.trim() || map.hotspots.length)
        .map(map => ({ ...map, imageUrl: map.imageUrl.trim(), hotspots: map.hotspots }))
    };
    exportResult.classList.add('hidden');
  }

  function imageUploadControl(map, mapIndex, card) {
    const label = el('label', {}, map.assetId ? 'Replace original image' : 'Upload image from this device');
    const input = el('input', { type: 'file', accept: 'image/jpeg,image/png' });
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const uploadStatus = el('p', { className: 'hint' }, 'Checking and uploading the original image…');
      card.append(uploadStatus);
      input.disabled = true;
      try {
        if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error('Choose a JPEG or PNG image.');
        if (file.size > 10 * 1024 * 1024) throw new Error('Image files must be 10 MiB or smaller.');
        const response = await fetch('/api/admin/campaign-assets', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'x-csrf-token': csrf, 'content-type': file.type, 'x-file-name': encodeURIComponent(file.name) },
          body: file
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Upload failed (${response.status}).`);
        const { originalFilename, contentType, fileSizeBytes, width, height, sha256 } = data.asset;
        maps[mapIndex] = {
          ...map, imageUrl: data.imageUrl, assetId: data.asset.assetId,
          metadata: { originalFilename, contentType, fileSizeBytes, width, height, sha256 },
          hotspots: map.hotspots
        };
        saveMaps();
        exportResult.classList.add('hidden');
        validationBox.replaceChildren();
        render();
      } catch (error) {
        uploadStatus.className = 'error';
        uploadStatus.textContent = error instanceof Error ? error.message : 'Image upload failed.';
        input.disabled = false;
      }
    };
    label.append(input);
    return label;
  }

  function render() {
    if (!state) return;
    mapsBox.replaceChildren();
    addMapButton.disabled = maps.length >= 4;
    const targets = availableTargets();
    if (!selectedTarget || !readTarget(selectedTarget)) selectedTarget = targets[0] ? targetValue(targets[0]) : '';

    maps.forEach((map, mapIndex) => {
      const card = el('article', { className: 'hotspot-map' });
      card.dataset.mapIndex = String(mapIndex);
      const header = el('div', { className: 'hotspot-map-header' });
      const removeMap = el('button', { type: 'button', className: 'danger' }, 'Remove image');
      removeMap.onclick = () => {
        maps.splice(mapIndex, 1);
        selectedAreas.clear();
        drawingMap = -1;
        saveMaps();
        render();
      };
      header.append(el('strong', {}, `2 · Image ${mapIndex + 1}`), removeMap);
      card.append(header, imageUploadControl(map, mapIndex, card));

      if (map.metadata) {
        const metadata = map.metadata;
        const details = el('p', { className: 'hint image-metadata' },
          `${metadata.originalFilename} · ${metadata.contentType} · ${(metadata.fileSizeBytes / 1024 / 1024).toFixed(2)} MiB · ${metadata.width} × ${metadata.height} px`);
        details.append(el('br'), el('a', { href: map.imageUrl, target: '_blank', rel: 'noreferrer' }, map.imageUrl));
        card.append(details);
      } else if (map.imageUrl) {
        card.append(el('p', { className: 'error' }, 'This image has no verified upload metadata. Replace it with an uploaded image before export.'));
      }

      const targetPicker = el('label', {}, '3 · Bind new area to an existing enabled target');
      const targetSelect = el('select');
      if (!targets.length) targetSelect.append(el('option', { value: '' }, 'Enable a button or activity first'));
      for (const target of targets) {
        const value = targetValue(target);
        targetSelect.append(el('option', { value }, `${target.type.toUpperCase()} · ${target.key} · ${target.label || '(no label)'} · ${target.actionType} · ${target.actionValue || '(no value)'}`));
      }
      targetSelect.value = selectedTarget;
      targetSelect.onchange = () => { selectedTarget = targetSelect.value; };
      targetPicker.append(targetSelect);
      card.append(targetPicker);

      const canvas = el('div', { className: 'hotspot-canvas' });
      if (map.imageUrl) {
        const frame = el('div', { className: `hotspot-frame${drawingMap === mapIndex ? ' is-drawing' : ''}` });
        const image = el('img', { src: map.imageUrl, alt: `Uploaded image ${mapIndex + 1}; original proportions` });
        image.draggable = false;
        image.onload = () => {
          const size = el('p', { className: 'hint' }, `Source dimensions: ${image.naturalWidth} × ${image.naturalHeight} px · display preserves the original aspect ratio.`);
          if (map.metadata) size.dataset.sourceSize = `${map.metadata.width}x${map.metadata.height}`;
          const oldSize = canvas.querySelector('.source-image-size');
          if (oldSize) oldSize.remove();
          size.className = 'hint source-image-size';
          canvas.prepend(size);
        };
        image.onerror = () => canvas.replaceChildren(el('p', { className: 'error' }, 'Image could not be loaded. Upload it again or check the image URL.'));
        frame.append(image);

        map.hotspots.forEach((hotspot, areaIndex) => {
          const target = targetFromHotspot(hotspot);
          const overlay = el('div', { className: `hotspot-area${selectedAreas.get(mapIndex) === areaIndex ? ' is-selected' : ''}` });
          overlay.tabIndex = 0;
          overlay.setAttribute('role', 'button');
          overlay.setAttribute('aria-label', `Touch area ${areaIndex + 1}: ${hotspot.targetType} ${hotspot.targetKey}`);
          Object.assign(overlay.style, {
            left: `${hotspot.x / 10}%`, top: `${hotspot.y / 10}%`,
            width: `${hotspot.width / 10}%`, height: `${hotspot.height / 10}%`
          });
          overlay.append(el('span', {}, `${hotspot.targetType}:${hotspot.targetKey}${target?.label ? ` · ${target.label}` : ''}`));
          const resize = el('span', { className: 'resize-handle resize-se', 'aria-label': 'Resize hotspot' });
          overlay.append(resize);
          overlay.onpointerdown = event => {
            if (drawingMap === mapIndex || event.button !== 0) return;
            event.stopPropagation();
            const bounds = frame.getBoundingClientRect();
            const mode = event.target === resize ? 'resize' : 'move';
            drag = { mapIndex, areaIndex, mode, x: event.clientX, y: event.clientY, bounds, original: { ...hotspot }, overlay };
            selectedAreas.set(mapIndex, areaIndex);
            frame.setPointerCapture(event.pointerId);
            overlay.classList.add('is-selected');
            event.preventDefault();
          };
          overlay.onkeydown = event => {
            const step = event.shiftKey ? 10 : 1;
            let changed = true;
            if (event.key === 'ArrowLeft') {
              if (event.shiftKey) hotspot.width = Math.max(1, hotspot.width - step);
              else hotspot.x = Math.max(0, hotspot.x - step);
            } else if (event.key === 'ArrowRight') {
              if (event.shiftKey) hotspot.width = Math.min(1000 - hotspot.x, hotspot.width + step);
              else hotspot.x = Math.min(1000 - hotspot.width, hotspot.x + step);
            } else if (event.key === 'ArrowUp') {
              if (event.shiftKey) hotspot.height = Math.max(1, hotspot.height - step);
              else hotspot.y = Math.max(0, hotspot.y - step);
            } else if (event.key === 'ArrowDown') {
              if (event.shiftKey) hotspot.height = Math.min(1000 - hotspot.y, hotspot.height + step);
              else hotspot.y = Math.min(1000 - hotspot.height, hotspot.y + step);
            } else {
              changed = false;
            }
            if (!changed) return;
            event.preventDefault();
            selectedAreas.set(mapIndex, areaIndex);
            saveMaps();
            render();
            mapsBox.querySelectorAll(`.hotspot-map[data-map-index="${mapIndex}"] .hotspot-area`)[areaIndex]?.focus();
          };
          frame.append(overlay);
        });

        let drawingStart = null;
        let draftArea = null;
        frame.addEventListener('pointerdown', event => {
          if (drawingMap !== mapIndex || event.button !== 0 || !targets.length || event.target.closest('.hotspot-area')) return;
          const bounds = frame.getBoundingClientRect();
          drawingStart = { x: event.clientX, y: event.clientY, bounds };
          frame.setPointerCapture(event.pointerId);
          draftArea = el('div', { className: 'hotspot-area is-pending' });
          frame.append(draftArea);
          event.preventDefault();
        });
        frame.addEventListener('pointermove', event => {
          if (drag?.mapIndex === mapIndex) {
            updateDrag(event);
            return;
          }
          if (!drawingStart || !draftArea) return;
          const bounds = drawingStart.bounds;
          const left = Math.max(0, Math.min(drawingStart.x, event.clientX) - bounds.left);
          const top = Math.max(0, Math.min(drawingStart.y, event.clientY) - bounds.top);
          const right = Math.min(bounds.width, Math.max(drawingStart.x, event.clientX) - bounds.left);
          const bottom = Math.min(bounds.height, Math.max(drawingStart.y, event.clientY) - bounds.top);
          Object.assign(draftArea.style, {
            left: `${100 * left / bounds.width}%`, top: `${100 * top / bounds.height}%`,
            width: `${100 * (right - left) / bounds.width}%`, height: `${100 * (bottom - top) / bounds.height}%`
          });
        });
        frame.addEventListener('pointerup', event => {
          if (drag?.mapIndex === mapIndex) {
            drag = null;
            saveMaps();
            render();
            return;
          }
          if (!drawingStart) return;
          const { bounds } = drawingStart;
          const x1 = Math.max(0, Math.min(bounds.width, drawingStart.x - bounds.left));
          const y1 = Math.max(0, Math.min(bounds.height, drawingStart.y - bounds.top));
          const x2 = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
          const y2 = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
          const left = Math.min(x1, x2), top = Math.min(y1, y2);
          const width = Math.abs(x2 - x1), height = Math.abs(y2 - y1);
          drawingStart = null;
          draftArea?.remove();
          draftArea = null;
          if (width < bounds.width * 0.008 || height < bounds.height * 0.008) return;
          const target = selectedTargetEntry();
          if (!target) return;
          const x = Math.max(0, Math.min(999, Math.round(1000 * left / bounds.width)));
          const y = Math.max(0, Math.min(999, Math.round(1000 * top / bounds.height)));
          const hotspot = {
            id: crypto.randomUUID(), targetType: target.type, targetKey: target.key, x, y,
            width: Math.max(1, Math.min(1000 - x, Math.round(1000 * width / bounds.width))),
            height: Math.max(1, Math.min(1000 - y, Math.round(1000 * height / bounds.height)))
          };
          map.hotspots.push(hotspot);
          selectedAreas.set(mapIndex, map.hotspots.length - 1);
          saveMaps();
          drawingMap = -1;
          render();
        });
        frame.addEventListener('pointercancel', () => {
          drawingStart = null;
          draftArea?.remove();
          draftArea = null;
          drag = null;
        });
        canvas.append(frame);
      } else {
        card.append(el('p', { className: 'hint' }, 'Upload an image to show exact dimensions and place its touch areas.'));
      }

      const drawButton = el('button', { type: 'button', className: 'secondary' },
        drawingMap === mapIndex ? 'Stop drawing areas' : 'Draw touch area');
      drawButton.disabled = !map.imageUrl || !targets.length || map.hotspots.length >= 50;
      drawButton.onclick = () => { drawingMap = drawingMap === mapIndex ? -1 : mapIndex; render(); };
      card.append(drawButton, canvas);

      const areaList = el('ol', { className: 'hotspot-area-list' });
      map.hotspots.forEach((hotspot, areaIndex) => {
        const row = el('li');
        row.dataset.areaIndex = String(areaIndex);
        const target = targetFromHotspot(hotspot);
        const choose = el('select');
        if (!target || !target.enabled) choose.append(el('option', { value: targetValue(hotspot) },
          `${target?.enabled === false ? 'Disabled target' : 'Missing target'} · ${hotspot.targetType}:${hotspot.targetKey}`));
        for (const item of availableTargets()) choose.append(el('option', { value: targetValue(item) },
          `${item.type.toUpperCase()} · ${item.key} · ${item.label} · ${item.actionType} · ${item.actionValue || '(no value)'}`));
        choose.value = targetValue(hotspot);
        choose.onchange = () => {
          const next = readTarget(choose.value);
          if (next) { hotspot.targetType = next.type; hotspot.targetKey = next.key; saveMaps(); render(); }
        };
        const coordinates = el('span', {}, `x ${hotspot.x}, y ${hotspot.y}, w ${hotspot.width}, h ${hotspot.height} / 1000 · ${hotspot.targetType.toUpperCase()} · ${target?.actionType || 'missing action'} · ${target?.actionValue || 'missing value'}`);
        const select = el('button', { type: 'button', className: 'secondary' }, 'Select');
        select.onclick = () => {
          selectedAreas.set(mapIndex, areaIndex);
          render();
          mapsBox.querySelectorAll(`.hotspot-map[data-map-index="${mapIndex}"] .hotspot-area`)[areaIndex]?.focus();
        };
        const remove = el('button', { type: 'button', className: 'danger' }, 'Delete area');
        remove.onclick = () => {
          map.hotspots.splice(areaIndex, 1);
          selectedAreas.clear();
          saveMaps();
          render();
        };
        row.append(choose, coordinates, select, remove);
        areaList.append(row);
      });
      card.append(areaList);
      mapsBox.append(card);
    });
  }

  let drag = null;
  function updateDrag(event) {
    if (!drag) return;
    const map = maps[drag.mapIndex];
    const hotspot = map?.hotspots[drag.areaIndex];
    if (!hotspot) return;
    const dx = Math.round(1000 * (event.clientX - drag.x) / drag.bounds.width);
    const dy = Math.round(1000 * (event.clientY - drag.y) / drag.bounds.height);
    if (drag.mode === 'move') {
      hotspot.x = Math.max(0, Math.min(1000 - hotspot.width, drag.original.x + dx));
      hotspot.y = Math.max(0, Math.min(1000 - hotspot.height, drag.original.y + dy));
    } else {
      hotspot.width = Math.max(1, Math.min(1000 - hotspot.x, drag.original.width + dx));
      hotspot.height = Math.max(1, Math.min(1000 - hotspot.y, drag.original.height + dy));
    }
    const overlay = drag.overlay;
    if (overlay) Object.assign(overlay.style, {
      left: `${hotspot.x / 10}%`, top: `${hotspot.y / 10}%`,
      width: `${hotspot.width / 10}%`, height: `${hotspot.height / 10}%`
    });
  }

  addMapButton.onclick = () => {
    if (maps.length >= 4) return;
    maps.push({ imageUrl: '', hotspots: [] });
    render();
  };
  orphanButton.onclick = async () => {
    orphanButton.disabled = true;
    try {
      const report = await api('/api/admin/campaign-assets/orphans');
      validationBox.replaceChildren(el('p', { className: 'warning' },
        `Dry-run only: ${report.orphanCount} upload(s) are not referenced by a saved campaign. No files were deleted.`));
      for (const asset of report.orphans) {
        validationBox.append(el('p', { className: 'hint' },
          `${asset.originalFilename} · ${asset.assetId} · ${asset.width} × ${asset.height} px · uploaded ${asset.uploadedAt}`));
      }
    } catch (error) {
      validationBox.append(el('p', { className: 'issue' }, error instanceof Error ? error.message : 'Could not inspect uploaded assets.'));
    } finally {
      orphanButton.disabled = false;
    }
  };
  exportButton.onclick = async () => {
    if (!state || !activeId) return;
    exportButton.disabled = true;
    exportButton.textContent = 'Checking plan…';
    validationBox.replaceChildren();
    exportResult.classList.add('hidden');
    try {
      const result = await api(`/api/admin/campaigns/${encodeURIComponent(activeId)}/image-plan/export`, {
        method: 'POST', body: { expectedVersion: version, draft: collect() }
      });
      const validation = result.validation || {};
      for (const warning of validation.warnings || []) validationBox.append(el('p', { className: 'warning' }, `Warning: ${warning.message}`));
      for (const issue of validation.blockers || []) {
        const item = el('button', { type: 'button', className: 'issue hotspot-issue-link' }, `${issue.path}: ${issue.message} · Go to field`);
        item.onclick = () => document.querySelector(issue.selector || '#editor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        validationBox.append(item);
      }
      if (validation.blockers?.length) return;
      const blob = new Blob([JSON.stringify(result.plan, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `${state.campaign.code || 'campaign'}-image-handoff.json`;
      link.click();
      URL.revokeObjectURL(url);
      promptText.value = result.prompt;
      exportResult.classList.remove('hidden');
      validationBox.prepend(el('p', { className: 'validation-ready' }, 'Ready for internal handoff · no blockers found. This file is not a LINE message or a publishable campaign.'));
    } catch (error) {
      const messages = error?.data?.issues || error?.data?.details || [];
      if (error?.data?.validation) {
        for (const issue of error.data.validation.blockers || []) {
          const item = el('button', { type: 'button', className: 'issue hotspot-issue-link' }, `${issue.path}: ${issue.message} · Go to field`);
          item.onclick = () => document.querySelector(issue.selector || '#editor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          validationBox.append(item);
        }
        for (const warning of error.data.validation.warnings || []) validationBox.append(el('p', { className: 'warning' }, `Warning: ${warning.message}`));
      } else if (messages.length) {
        for (const issue of messages) validationBox.append(el('p', { className: 'issue' },
          `${Array.isArray(issue.path) ? issue.path.join('.') : issue.path || 'Draft'}: ${issue.message || 'Invalid campaign data.'}`));
      } else {
        validationBox.append(el('p', { className: 'issue' }, error instanceof Error ? error.message : 'Export validation failed.'));
      }
    } finally {
      exportButton.disabled = false;
      exportButton.textContent = '4 · Validate and export handoff';
    }
  };
  section.querySelector('.hotspot-copy-prompt').onclick = async () => {
    try {
      await navigator.clipboard.writeText(promptText.value);
      section.querySelector('.hotspot-copy-prompt').textContent = 'Copied';
    } catch {
      promptText.focus();
      promptText.select();
      validationBox.append(el('p', { className: 'warning' }, 'Clipboard access was denied; select and copy the prompt manually.'));
    }
  };

  window.addEventListener('campaign-editor-filled', () => {
    maps = initialMaps();
    drawingMap = -1;
    selectedAreas = new Map();
    saveMaps();
    render();
  });
  window.addEventListener('campaign-draft-collect', event => {
    const draft = event.detail;
    draft.campaign.settings = {
      ...draft.campaign.settings,
      imageHotspots: maps
        .filter(map => map.imageUrl.trim() || map.hotspots.length)
        .map(map => ({ ...map, imageUrl: map.imageUrl.trim(), hotspots: map.hotspots }))
    };
  });
})();
