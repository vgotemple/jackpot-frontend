var GameStatus = {
    0: "WAITING_FOR_DEPOSITS",
    1: "COUNTDOWN",
    2: "WAITING_FOR_OUTCOME",
    3: "ROLLING",
    4: "ROLLED"
};

const wax = new waxjs.WaxJS('https://wax.greymass.com');

const app = new Vue({
    el: '#app',
    data: {
        socket: null,
        user: null,
        game: null,
        popup: null,
        inventory: [],
        GameStatus: GameStatus,
        selectedItems: [],
        toast: null,
        winner: null,
        lastUpdated: 0,
        vgoPricing: [],
        history: [],
    },
    mounted() {
        this.autoLogin();
        this.registerSocket();
        this.loadVGOSkins();
        this.loadHistory();
    },
    methods: {
        timeFormat(time) {
            var hrs = ~~(time / 3600);
            var mins = ~~((time % 3600) / 60);
            var secs = ~~time % 60;
            var ret = "";
            if (hrs > 0) {
                ret += "" + hrs + ":" + (mins < 10 ? "0" : "");
            }
            ret += "" + mins + ":" + (secs < 10 ? "0" : "");
            ret += "" + secs;
            return ret;
        },
        async autoLogin() {
            var isAutoLoginAvailable = await wax.isAutoLoginAvailable();
            if (isAutoLoginAvailable) {
                this.user = wax.userAccount;
            } else {
                this.user = null;
            }
        },
        async registerSocket() {
            if (!this.socket) {
                var socket = io(config.backendAddress);
                socket.on('connect', () => {
                    socket.on("jackpot_game", game => {
                        this.game = game;
                        this.loadHistory();
                    })
                    socket.on("jackpot_status", status => {
                        if (this.game) {
                            this.game.status = status;
                        }
                    })
                    socket.on("jackpot_countdown", countdown => {
                        if (this.game) {
                            this.game.countdown = countdown;
                        }
                    })
                    socket.on("jackpot_winner", winner => {
                        if (this.game) {
                            this.game.winner = winner;
                        }
                        this.showToast(`${winner} won the pot!`, "info")
                    })
                    socket.on("jackpot_deposit", deposit => {
                        if (this.game) {
                            if (deposit.accountName == this.user) {
                                this.showToast(`Deposited ${deposit.nfts.length} items!`, "success")
                            }
                            this.game.deposits.push(deposit);
                        }
                    })
                });

                this.socket = socket;
            }
        },
        getTotalSkins() {
            let skins = 0;
            if (this.game && this.game.deposits) {
                for (let i = 0; i < this.game.deposits.length; i++) {
                    skins += this.game.deposits[i].nfts.length;
                }
            }
            return skins;
        },
        async loadHistory () {
            getHistory().then(history => {
                this.history = history;
            }).catch(err => {})
        },
        depositsWithTickets (deposits) {
            let lastTicket = 0;
            for (let i = 0; i<deposits.length; i++) {
                deposits[i].tickets = {
                    from: lastTicket+1,
                    to: lastTicket+deposits[i].worth
                };
                lastTicket += deposits[i].worth
            }
            return deposits;
        },
        showToast (text, type=null, time=2500) {
            this.hideToast();
            let color = "3c74ce"
            if (type) {
                switch (type) {
                    case 'success':
                        color = "7ad430";
                        break;
                    case 'warning':
                        color = "ce763c";
                        break;
                    case 'error':
                        color = "d43030";
                        break;
                    default:
                        color = "3c74ce";
                        break;
                }
            }
            let hideTimeout = setTimeout(() => {
                this.hideToast();
            }, time);
            this.toast = {
                text: text,
                color: color,
                hideTimeout: hideTimeout,
            }
            
        },
        async login() {
            try {
                const userAccount = await wax.login();
                this.user = userAccount;
            } catch (e) {
                console.log(e)
            }
        },
        openDeposit () {
            this.popup = "deposit";
            getFullInventory(this.user).then(inv => {
                this.inventory = inv.filter(item => !item.delegated).map(item => {
                    let items = this.vgoPricing.filter(vgoItem => {
                        return vgoItem.market_name == item.mdata.name
                    });
                    if (items.length == 1) {
                        item.rarity = items[0].rarity;
                        item.price = items[0].price;
                    } else {
                        item.price = 0;
                    }
                    return item;
                }).sort((a, b) => b.price - a.price);
            })
        },
        loadVGOSkins () {
            axios.get("https://morevgo.com/pricing")
            .then(x => x.data)
            .then((skins) => {
                this.vgoPricing = skins;
            });
        },
        selectItem (assetid) {
            if (!this.selectedItems.includes(assetid)) {
                this.selectedItems.push(assetid)
            } else {
                this.selectedItems.splice(this.selectedItems.indexOf(assetid), 1)
            }
        },
        getPrice (market_name) {
            let price = 0;
            let items = this.vgoPricing ? this.vgoPricing.filter(item => item.market_name == market_name) : [];
            if (items.length) {
                price = items[0].price;
            }
            return price;
        },
        async deposit() {
            this.showToast(`Depositing ${this.selectedItems.length} items`)
            if (this.selectedItems.length) {
                try {
                    const result = await wax.api.transact({
                        actions: [{
                            account: 'simpleassets',
                            name: 'transfer',
                            authorization: [{
                                actor: this.user,
                                permission: 'active',
                            }],
                            data: {
                                from: this.user,
                                to: config.accountName,
                                assetids: this.selectedItems,
                                memo: "Deposit#Jackpot",
                            },
                        }]
                    }, {
                        blocksBehind: 3,
                        expireSeconds: 300
                    });
                    this.showToast(`Transaction succeded`, "success");
                    this.closePopup();
                } catch (err) {
                    this.showToast(err, "error", 5000)
                }
            } else {
                this.showToast("No items selected", "error")
            }
        },
        hideToast () {
            if (this.toast) {
                clearTimeout(this.toast.hideTimeout);
                this.toast = null;
            }
        },
        closePopup () {
            this.popup = null;
            selectedItems = [];
        },
    }
});


function getInventoryByLowerBound (account, lower_bound="") {
    return new Promise((resolve, reject) => {
        wax.rpc.get_table_rows({
            json: true,
            code: 'simpleassets',
            scope: account,
            table: 'sassets',
            lower_bound: lower_bound,
            limit: 100,
        }).then(async result => {
            resolve(result)
        }).catch(err => { reject(err) });
    });
}

function getFullInventory (account, temp=[], lower_bound="") {
    return new Promise(async (resolve, reject) => {
        let inv = await getInventoryByLowerBound(account, lower_bound);
        temp = temp.concat(inv.rows)
        if (inv.more) {
            let new_lower_bound = inv.rows[inv.rows.length - 1].id;
            resolve(await getFullInventory(account, temp.filter(({id}) => id !== new_lower_bound), new_lower_bound));
        } else {
            let delegated = await getDelegated();
            temp = temp.filter(nft => nft.author === "vgo");
            temp = temp.map(nft => {
                try { nft.mdata = JSON.parse(nft.mdata) } catch(e) {}
                try { nft.idata = JSON.parse(nft.idata) } catch(e) {}
                let name;
                if (nft.mdata && nft.mdata.name) name = nft.mdata.name;
                let data = {};
                if (name) {
                    var nameSec = name.split(" | ");
                    var condMatches = name.match(/\((.*?)\)/);
                    data.weapon_type = nameSec[0];
                    data.skin_name = nameSec[1].split(" (")[0];
                    data.market_name = name;
                    data.image = nft.mdata.img;
                    nft.delegated = delegated.includes(nft.id);
                    if (condMatches) data.condition = condMatches[1].replace('-', ' ');
                }
                nft.data = data;
                return nft;
            });
            resolve(temp)
        }
    });
}

function getDelegated () {
    return new Promise((resolve, reject) => {
        wax.rpc.get_table_rows({
            json: true,
            code: 'simpleassets',
            scope: "simpleassets",
            table: 'delegates',
            limit: 100,
        }).then(result => {
            let delegated = [];
            if (result && result.rows && result.rows.length > 0) delegated = result.rows.map(row => row.assetid);
            resolve(delegated)
        }).catch(err => { reject(err) });
    })
}

function getHistory () {
    let path = config.backendAddress;
    if (!path.endsWith("/")) path += "/";
    path += "jackpot/history"
    return axios.get(path).then(x => x.data);
}
