const campaignImageUrls = {
  hero: 'https://olo1.duckdns.org/campaign-images/ole88-promo.png',
  secondary: 'https://olo1.duckdns.org/campaign-images/ole88-how-to.png'
};

const heroField = $('heroImage').closest('label');
const secondaryLabel = document.createElement('label');
secondaryLabel.append(document.createTextNode('Secondary image HTTPS URL'));
const secondaryInput = el('input', {
  id: 'secondaryImage',
  type: 'url',
  placeholder: 'https://olo1.duckdns.org/campaign-images/ole88-how-to.png'
});
secondaryLabel.append(secondaryInput);

const artworkButton = el('button', { type: 'button', className: 'secondary' }, 'Use supplied OLE88 artwork');
artworkButton.onclick = () => {
  $('heroImage').value = campaignImageUrls.hero;
  secondaryInput.value = campaignImageUrls.secondary;
  state.campaign.heroImage = campaignImageUrls.hero;
  state.campaign.settings = { ...state.campaign.settings, secondaryImage: campaignImageUrls.secondary };
  renderHero();
};

heroField.after(secondaryLabel, artworkButton);
heroField.parentElement.nextElementSibling.textContent =
  'The supplied images are hosted on this staging site. Add image URLs over HTTPS; saving remains a separate action.';

const renderHeroBase = renderHero;
renderHero = () => {
  renderHeroBase();
  const url = state?.campaign.settings?.secondaryImage;
  if (!url) return;
  const image = el('img', { src: url, alt: 'Secondary campaign image preview', className: 'campaign-image-preview' });
  image.onerror = () => image.remove();
  $('heroPreview').append(image);
};

const fillBase = fill;
fill = () => {
  fillBase();
  secondaryInput.value = state.campaign.settings?.secondaryImage || '';
  renderHero();
};

secondaryInput.addEventListener('input', () => {
  if (!state) return;
  state.campaign.settings = {
    ...state.campaign.settings,
    secondaryImage: secondaryInput.value.trim() || null
  };
  renderHero();
});

const drawPreviewBase = drawPreview;
drawPreview = (box, title, messages) => {
  drawPreviewBase(box, title, messages);
  if (title !== 'Welcome card preview') return;
  const imageUrl = messages?.flatMap(message => message.type === 'flex'
    ? message.contents.body?.contents || []
    : []).find(content => content.type === 'image')?.url;
  if (!imageUrl) return;
  const image = el('img', { src: imageUrl, alt: 'Secondary campaign image preview', className: 'campaign-image-preview' });
  image.onerror = () => image.remove();
  box.lastElementChild.append(image);
};
