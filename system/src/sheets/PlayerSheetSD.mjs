import ActorSheetSD from "./ActorSheetSD.mjs";

export default class PlayerSheetSD extends ActorSheetSD {

	constructor(object, options) {
		super(object, options);

		this.gemBag = new shadowdark.apps.GemBagSD(this.actor);
	}

	/** @inheritdoc */
	static get defaultOptions() {
		return foundry.utils.mergeObject(super.defaultOptions, {
			classes: ["shadowdark", "sheet", "player"],
			width: 560,
			height: 560,
			resizable: true,
			tabs: [
				{
					navSelector: ".player-navigation",
					contentSelector: ".player-body",
					initial: "tab-abilities",
				},
			],
			dragDrop: [{
				dragSelector: ".item[draggable=true]",
			}],
		});
	}

	/** @inheritdoc */
	get template() {
		return "systems/shadowdark/templates/actors/player.hbs";
	}

	/** @inheritdoc */
	activateListeners(html) {
		html.find(".item-quantity-decrement").click(
			event => this._onItemQuantityDecrement(event)
		);

		html.find(".item-quantity-increment").click(
			event => this._onItemQuantityIncrement(event)
		);

		html.find(".item-toggle-equipped").click(
			event => this._onToggleEquipped(event)
		);

		html.find(".item-toggle-light").click(
			event => this._onToggleLightSource(event)
		);

		html.find(".language-list.languages").click(
			event => this._onKnownLanguages(event)
		);

		html.find(".open-gem-bag").click(
			event => this._onOpenGemBag(event)
		);

		html.find(".sell-treasure").click(
			event => this._onSellTreasure(event)
		);

		html.find(".toggle-spell-lost").click(
			event => this._onToggleSpellLost(event)
		);

		// Handle default listeners last so system listeners are triggered first
		super.activateListeners(html);
	}

	/** @override */
	async getData(options) {
		// Update the Gem Bag, but don't render it unless it's already showing
		this.gemBag.render(false);

		const context = await super.getData(options);

		context.gearSlots = this.actor.numGearSlots();

		context.xpNextLevel = context.system.level.value * 10;
		context.armorClass = await this.actor.getArmorClass();

		// Languages
		context.knownLanguages = [];
		for (const key of this.actor.system.languages) {
			context.knownLanguages.push(CONFIG.SHADOWDARK.LANGUAGES[key]);
		}
		context.knownLanguagesDisplay = context.knownLanguages.join(", ");

		// Get the inventory ready
		await this._prepareItems(context);

		context.abilitiesOverrides = Object.keys(
			foundry.utils.flattenObject(
				this.actor.overrides?.system?.abilities || {}
			)
		);
		context.attributeOverrides = Object.keys(
			foundry.utils.flattenObject(
				this.actor.overrides?.system?.attributes || {}
			)
		);

		return context;
	}

	async _onItemQuantityDecrement(event) {
		event.preventDefault();

		const itemId = $(event.currentTarget).data("item-id");
		const item = this.actor.getEmbeddedDocument("Item", itemId);

		if (item.system.quantity > 0) {
			this.actor.updateEmbeddedDocuments("Item", [
				{
					_id: itemId,
					"system.quantity": item.system.quantity - 1,
				},
			]);
		}
	}

	async _onItemQuantityIncrement(event) {
		event.preventDefault();

		const itemId = $(event.currentTarget).data("item-id");
		const item = this.actor.getEmbeddedDocument("Item", itemId);

		if (item.system.quantity < item.system.slots.per_slot) {
			this.actor.updateEmbeddedDocuments("Item", [
				{
					_id: itemId,
					"system.quantity": item.system.quantity + 1,
				},
			]);
		}
	}

	_onKnownLanguages(event) {
		event.preventDefault();

		new shadowdark.apps.PlayerLanguagesSD(
			this.actor, {event: event}
		).render(true);
	}

	async _onOpenGemBag(event) {
		event.preventDefault();

		this.gemBag.render(true);
	}

	_onSellTreasure(event) {
		event.preventDefault();

		const itemId = $(event.currentTarget).data("item-id");
		const itemData = this.object.getEmbeddedDocument("Item", itemId);

		renderTemplate(
			"systems/shadowdark/templates/dialog/sell-item.hbs",
			{name: itemData.name}
		).then(html => {
			new Dialog({
				title: `${game.i18n.localize("SHADOWDARK.dialog.item.confirm_sale")}`,
				content: html,
				buttons: {
					Yes: {
						icon: "<i class=\"fa fa-check\"></i>",
						label: `${game.i18n.localize("SHADOWDARK.dialog.general.yes")}`,
						callback: async () => {
							this.actor.sellItemById(itemId);
						},
					},
					Cancel: {
						icon: "<i class=\"fa fa-times\"></i>",
						label: `${game.i18n.localize("SHADOWDARK.dialog.general.cancel")}`,
					},
				},
				default: "Yes",
			}).render(true);
		});
	}

	async _onToggleEquipped(event) {
		event.preventDefault();

		const itemId = $(event.currentTarget).data("item-id");
		const item = this.actor.getEmbeddedDocument("Item", itemId);

		const [updatedItem] = await this.actor.updateEmbeddedDocuments("Item", [
			{
				_id: itemId,
				"system.equipped": !item.system.equipped,
			},
		]);

		if (item.type === "Armor") this.actor.updateArmor(updatedItem);
	}

	async _sendToggledLightSourceToChat(active, item) {
		const cardData = {
			active: active,
			name: item.name,
			timeRemaining: Math.floor(item.system.light.remainingSecs / 60),
			longevity: item.system.light.longevityMins,
			actor: this,
			item: item,
		};

		let template = "systems/shadowdark/templates/chat/lightsource-toggle.hbs";

		const content = await renderTemplate(template, cardData);

		await ChatMessage.create({
			content,
			speaker: ChatMessage.getSpeaker(),
			rollMode: CONST.DICE_ROLL_MODES.PUBLIC,
		});
	}

	async _onToggleLightSource(event) {
		event.preventDefault();

		const itemId = $(event.currentTarget).data("item-id");
		const item = this.actor.getEmbeddedDocument("Item", itemId);

		const active = !item.system.light.active;

		if (active) {
			// Find any currently active lights and turn them off
			const activeLightSources = await this.actor.getActiveLightSources();
			for (const lightSource of activeLightSources) {
				this.actor.updateEmbeddedDocuments(
					"Item", [{
						_id: lightSource.id,
						"system.light.active": false,
					}]
				);
			}
		}

		const dataUpdate = {
			_id: itemId,
			"system.light.active": active,
		};

		if (!item.system.light.hasBeenUsed) {
			dataUpdate["system.light.hasBeenUsed"] = true;
		}

		const [updatedLight] = await this.actor.updateEmbeddedDocuments(
			"Item", [dataUpdate]
		);

		// We only update the Light Source Tracker if this Actor is currently
		// selected by a User as their character
		//
		if (this.actor.isClaimedByUser()) {
			this._sendToggledLightSourceToChat(active, item);
			game.shadowdark.lightSourceTracker.toggleLightSource(
				this.actor,
				updatedLight
			);
		}

		this.actor.toggleLight(active, itemId);
	}

	async _onToggleSpellLost(event) {
		event.preventDefault();
		const itemId = $(event.currentTarget).data("item-id");
		const item = this.actor.getEmbeddedDocument("Item", itemId);

		this.actor.updateEmbeddedDocuments("Item", [
			{
				_id: itemId,
				"system.lost": !item.system.lost,
			},
		]);
	}

	async _prepareItems(context) {
		const gems = [];
		const inventory = {
			armor: {
				label: game.i18n.localize("SHADOWDARK.inventory.section.armor"),
				type: "Armor",
				items: [],
			},
			weapon: {
				label: game.i18n.localize("SHADOWDARK.inventory.section.weapon"),
				type: "Weapon",
				items: [],
			},
			basic: {
				label: game.i18n.localize("SHADOWDARK.inventory.section.basic"),
				type: "Basic",
				items: [],
			},
			treasure: {
				label: game.i18n.localize("SHADOWDARK.inventory.section.treasure"),
				items: [],
			},
		};
		const spells = {};

		const talents = {
			ancestry: {
				label: game.i18n.localize("SHADOWDARK.talent.class.ancestry"),
				items: [],
			},
			class: {
				label: game.i18n.localize("SHADOWDARK.talent.class.class"),
				items: [],
			},
			level: {
				label: game.i18n.localize("SHADOWDARK.talent.class.level"),
				items: [],
			},
		};

		const attacks = {melee: [], ranged: []};

		let slotCount = 0;

		for (const i of this._sortAllItems(context)) {
			if (i.type === "Armor" || i.type === "Basic" || i.type === "Weapon") {
				i.showQuantity = i.system.slots.per_slot > 1 ? true : false;

				// We calculate how many slots are used by this item, taking
				// into account the quantity and any free items.
				//
				const freeCarry = i.system.slots.free_carry;
				const perSlot = i.system.slots.per_slot;
				const quantity = i.system.quantity;
				const slotsUsed = i.system.slots.slots_used;

				let totalSlotsUsed = Math.ceil(quantity / perSlot) * slotsUsed;
				totalSlotsUsed -= freeCarry * slotsUsed;

				i.slotsUsed = totalSlotsUsed;

				slotCount += i.slotsUsed;

				const section = i.system.treasure
					? "treasure"
					: i.type.toLowerCase();

				inventory[section].items.push(i);

				if (i.type === "Basic" && i.system.light.isSource) {
					i.isLightSource = true;
					i.lightSourceActive = i.system.light.active;
					i.lightSourceUsed = i.system.light.hasBeenUsed;

					const timeRemaining = Math.ceil(
						i.system.light.remainingSecs / 60
					);

					i.lightSourceTimeRemaining = game.i18n.format(
						"SHADOWDARK.inventory.item.light_remaining",
						{ timeRemaining }
					);
				}

				if (i.type === "Weapon" && i.system.equipped) {
					const weaponAttacks = await this.actor.buildWeaponDisplays(i._id);
					attacks.melee.push(...weaponAttacks.melee);
					attacks.ranged.push(...weaponAttacks.ranged);
				}
			}
			else if (i.type === "Gem") {
				gems.push(i);
			}
			else if (i.type === "Spell") {
				const spellTier = i.system.tier;
				spells[spellTier] ||= [];
				spells[spellTier].push(i);
			}
			else if (i.type === "Talent") {
				const talentClass = i.system.talentClass;
				talents[talentClass].items.push(i);
			}
		}

		// Work out how many slots all these coins are taking up...
		const coins = this.actor.system.coins;
		const totalCoins = coins.gp + coins.sp + coins.cp;

		let coinSlots = 0;
		const freeCoins = CONFIG.SHADOWDARK.DEFAULTS.FREE_COIN_CARRY;
		if (totalCoins > freeCoins) {
			coinSlots = Math.ceil((totalCoins - freeCoins) / freeCoins);
		}

		// Now do the same for gems...
		let gemSlots = 0;
		let totalGems = gems.length;

		if (totalGems > 0) {
			gemSlots = Math.ceil(totalGems / CONFIG.SHADOWDARK.INVENTORY.GEMS_PER_SLOT);
		}

		context.attacks = attacks;
		context.coins = {totalCoins, coinSlots};
		context.gems = {items: gems, totalGems, gemSlots};
		context.inventory = inventory;
		context.slotsUsed = slotCount + coinSlots + gemSlots;
		context.spells = spells;

		// Sort these by level for display...
		talents.level.items = talents.level.items.sort(
			(a, b) => a.system.level - b.system.level
		);
		context.talents = talents;
	}

	// async _updateObject(event, formData) {
	// 	const actor = this.object;
	// 	let updateData = foundry.utils.expandObject(formData)
	// 	const src = actor.toObject();

	// }
}