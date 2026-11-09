import { setup } from '../../support/setup.js';
setup();

describe(`Online video embed`, () => {
	it('Can visit the page', () => {
		cy.visit('http://localhost:8080/embed/video');
	});

	it('Should have a play button', () => {
		cy.get('.owncast-big-play-button').should('be.visible');
	});
});
